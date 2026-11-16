import { Readable } from 'node:stream';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, test, vi } from 'vitest';
import type { ObjectStorage } from '../vault/storage';
import type { TenderRepository } from './tender.repository';
import { AnonymousDceUnavailableError } from '../watch/dossier.crawler';
import { checkDossierRevision, downloadAnonymousDossierForExtraction, readSavedDossierRevision, type RevisionCheckDependencies, type RevisionPortalAccess } from './dossier-revision-check';

const id = 'test-id';
const sourceUrl = 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=1058286&orgAcronyme=o8p';
const now = () => new Date('2026-11-13T10:00:00Z');
const original = Buffer.from(zipSync({ 'RC.pdf': strToU8('old source') }, { level: 0 }));

function fixture(options: { previous?: Buffer | null; fresh?: Buffer; cooldown?: number; failMetadata?: boolean; raw?: Record<string, unknown>; failDelete?: boolean } = {}) {
  const previous = options.previous === undefined ? original : options.previous;
  const objects = new Map<string, Buffer>();
  if (previous) objects.set(`dossiers/${id}.zip`, previous);
  let record: { id: string; sourceUrl: string; raw: Record<string, unknown>; estimationMad: number; cautionProvisoireMad: number } = {
    id, sourceUrl, estimationMad: 100000, cautionProvisoireMad: 1000,
    raw: { ...(previous ? { dossier: { objectKey: `dossiers/${id}.zip`, filename: 'old.zip', sizeBytes: previous.length, downloadedAt: '2026-11-10T10:00:00Z' } } : {}), ...options.raw },
  };
  let failMetadata = options.failMetadata;
  const update = vi.fn(async (_id: string, _amounts: unknown, patch: Record<string, unknown>) => {
    if (patch.dossier && failMetadata) { failMetadata = false; throw new Error('private DB error'); }
    record = { ...record, raw: { ...record.raw, ...patch } };
    return record;
  });
  const storage = {
    getObject: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { body: Readable.from([bytes]), sizeBytes: bytes.length, mime: 'application/zip' };
    }),
    put: vi.fn(async (key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); return {} as never; }),
    delete: vi.fn(async (key: string) => {
      if (options.failDelete && key.endsWith('.md')) throw new Error('private storage failure');
      objects.delete(key);
    }),
  } as unknown as ObjectStorage;
  const access: RevisionPortalAccess = {
    remainingCooldown: vi.fn(async () => options.cooldown ?? 0), markBlocked: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  const fresh = options.fresh ?? original;
  const fetchImpl = vi.fn(async () => new Response('ok'));
  const download = vi.fn(async (_ref, identity, guardedFetch) => {
    expect(identity).toBeNull();
    for (let step = 0; step < 4; step++) await guardedFetch('https://www.marchespublics.gov.ma/index.php');
    return { bytes: fresh, filename: 'fresh.zip', sizeBytes: fresh.length, mime: 'application/zip' };
  });
  const deps: RevisionCheckDependencies = {
    tenders: { findById: async () => record, updateEnrichment: update } as unknown as TenderRepository,
    storage, commit: vi.fn(async operation => operation()), now, fetchImpl: fetchImpl as typeof fetch,
    download, openPortalAccess: vi.fn(async () => access),
  };
  return { deps, objects, access, download, fetchImpl, update, getRecord: () => record };
}

describe('official DCE revision check', () => {
  test('confirms unchanged documents and preserves canonical cache date for a repacked ZIP', async () => {
    const repacked = Buffer.from(zipSync({ 'RC.pdf': strToU8('old source') }, { level: 9 }));
    const setup = fixture({ fresh: repacked });
    const evidence = await checkDossierRevision(id, setup.deps);
    expect(evidence).toMatchObject({ state: 'unchanged', documentsIdentical: true, officialIdentity: '1058286/o8p' });
    expect(evidence.previousArchiveSha256).not.toBe(evidence.sourceArchiveSha256);
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(original);
    expect(setup.getRecord().raw.dossier).toMatchObject({ downloadedAt: '2026-11-10T10:00:00Z' });
    expect(setup.fetchImpl).toHaveBeenCalledTimes(4);
    expect(setup.access.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(evidence)).not.toMatch(/objectKey|password|minio|dossiers\//i);
  });

  test('preserves both versions and activates changed documents under the commit gate', async () => {
    const fresh = Buffer.from(zipSync({ 'RC.pdf': strToU8('new source') }));
    const setup = fixture({ fresh });
    const evidence = await checkDossierRevision(id, setup.deps);
    expect(evidence).toMatchObject({ state: 'updated', changedFiles: ['RC.pdf'], documentsIdentical: false });
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(fresh);
    expect(setup.objects.get(`dossiers/${id}/revisions/${evidence.previousArchiveSha256}.zip`)).toEqual(original);
    expect(setup.objects.get(`dossiers/${id}/revisions/${evidence.sourceArchiveSha256}.zip`)).toEqual(fresh);
    expect(setup.deps.commit).toHaveBeenCalledOnce();
    expect(setup.deps.storage.delete).toHaveBeenCalledWith(`dossiers/${id}.md`);
    expect(setup.getRecord().raw.dossier).toMatchObject({ downloadedAt: now().toISOString() });
  });

  test('can obtain a first archive without inventing identity fields', async () => {
    const setup = fixture({ previous: null });
    const evidence = await checkDossierRevision(id, setup.deps);
    expect(evidence).toMatchObject({ state: 'downloaded', documentsIdentical: false });
    expect(evidence.previousArchiveSha256).toBeUndefined();
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(original);
  });

  test('uses the configured account transport only after selecting account mode', async () => {
    const setup = fixture({ previous: null });
    setup.deps.authenticatedTransport = vi.fn(async guarded => guarded);
    const anonymous = await checkDossierRevision(id, setup.deps);
    expect(anonymous).toMatchObject({ state: 'downloaded', mode: 'anonymous' });
    expect(setup.deps.authenticatedTransport).not.toHaveBeenCalled();

    setup.deps.usePortalAccount = true;
    const account = await checkDossierRevision(id, setup.deps);
    expect(account).toMatchObject({ state: 'unchanged', mode: 'account' });
    expect(setup.deps.authenticatedTransport).toHaveBeenCalledOnce();
    expect(setup.download).toHaveBeenLastCalledWith(expect.anything(), null, expect.any(Function), expect.objectContaining({ usePortalAccount: true }));
    expect(readSavedDossierRevision(setup.getRecord().raw, sourceUrl, now())).toMatchObject({ mode: 'account' });
  });

  test('a lost response after withdrawal is sent requires checking the official portal before retrying', async () => {
    const setup = fixture();
    setup.deps.usePortalAccount = true;
    setup.deps.authenticatedTransport = async guarded => guarded;
    setup.fetchImpl.mockImplementation(async () => {
      expect(setup.getRecord().raw.dossierRevision).toMatchObject({ mode: 'account', reason: 'withdrawal_unconfirmed' });
      return new Response('ok');
    });
    setup.deps.download = async (_ref, _identity, guarded) => {
      await guarded!('https://www.marchespublics.gov.ma/index.php', {
        method: 'POST', body: new URLSearchParams({ PRADO_POSTBACK_TARGET: 'ctl0$CONTENU_PAGE$validateButton' }).toString(),
      });
      throw new Error('Response lost after withdrawal');
    };
    const evidence = await checkDossierRevision(id, setup.deps);
    expect(evidence).toMatchObject({ state: 'unavailable', mode: 'account', reason: 'withdrawal_unconfirmed' });
    expect(evidence.retryAt).toBeUndefined();
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(original);
    setup.deps.download = vi.fn(async () => { throw new Error('Anonymous route unavailable'); });
    expect(await checkDossierRevision(id, setup.deps)).toEqual(evidence);
    expect(setup.deps.download).not.toHaveBeenCalled();
    setup.deps.usePortalAccount = false;
    expect(await checkDossierRevision(id, setup.deps)).toEqual(evidence);
    expect(setup.deps.download).toHaveBeenCalledOnce();
  });

  test('never sends the withdrawal when its preflight evidence cannot be saved', async () => {
    const setup = fixture();
    setup.deps.usePortalAccount = true;
    setup.deps.authenticatedTransport = async guarded => guarded;
    setup.update.mockRejectedValueOnce(new Error('Persistence unavailable'));
    setup.deps.download = async (_ref, _identity, guarded) => {
      await guarded!('https://www.marchespublics.gov.ma/index.php', {
        method: 'POST', body: new URLSearchParams({ PRADO_POSTBACK_TARGET: 'ctl0$CONTENU_PAGE$validateButton' }).toString(),
      });
      throw new Error('Unexpected dispatch');
    };
    const result = await checkDossierRevision(id, setup.deps);
    expect(result.reason).toBe('download_failed');
    expect(setup.fetchImpl).not.toHaveBeenCalled();
  });

  test('cooldown and nightly closure stop before download', async () => {
    const setup = fixture({ cooldown: 5000 });
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'cooldown', retryAt: '2026-11-13T10:00:05.000Z' });
    expect(setup.download).not.toHaveBeenCalled();
    const closed = fixture();
    closed.deps.now = () => new Date('2026-11-13T01:00:00Z');
    expect(await checkDossierRevision(id, closed.deps)).toMatchObject({ state: 'unavailable', reason: 'scheduled_closure' });
    expect(closed.deps.openPortalAccess).not.toHaveBeenCalled();
    expect(closed.download).not.toHaveBeenCalled();
  });

  test('checks shared cooldown between every request and propagates portal blocks', async () => {
    const setup = fixture();
    vi.mocked(setup.access.remainingCooldown).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(60000);
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'cooldown' });
    expect(setup.fetchImpl).toHaveBeenCalledOnce();
    const blocked = fixture();
    blocked.fetchImpl.mockResolvedValueOnce(new Response('blocked', { status: 433 }));
    expect(await checkDossierRevision(id, blocked.deps)).toMatchObject({ state: 'unavailable', reason: 'blocked' });
    expect(blocked.access.markBlocked).toHaveBeenCalledOnce();
    expect(blocked.fetchImpl).toHaveBeenCalledOnce();
  });

  test('rolls back canonical bytes when metadata cannot be saved', async () => {
    const fresh = Buffer.from(zipSync({ 'RC.pdf': strToU8('new source') }));
    const setup = fixture({ fresh, failMetadata: true });
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'verification_unavailable' });
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(original);
    expect(setup.getRecord().raw.dossier).toMatchObject({ downloadedAt: '2026-11-10T10:00:00Z' });
  });

  test('failed derived Markdown invalidation cannot activate new canonical bytes', async () => {
    const fresh = Buffer.from(zipSync({ 'RC.pdf': strToU8('new source') }));
    const setup = fixture({ fresh, failDelete: true });
    setup.objects.set(`dossiers/${id}.md`, Buffer.from('old versioned Markdown'));
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'verification_unavailable' });
    expect(setup.objects.get(`dossiers/${id}.zip`)).toEqual(original);
    expect(setup.objects.get(`dossiers/${id}.md`)?.toString()).toBe('old versioned Markdown');
    expect(setup.getRecord().raw.dossier).toMatchObject({ downloadedAt: '2026-11-10T10:00:00Z' });
    expect(setup.update.mock.calls.some(([, , patch]) => Boolean(patch.dossier))).toBe(false);
  });

  test('changed documents archive and invalidate old extraction fields while retaining portal facts', async () => {
    const derived = {
      dossierExtraction: { bpu: [{ designation: 'obsolete BPU' }], qualifications: ['obsolete qualification'], conditionsLegales: ['obsolete condition'] },
      dossierText: 'old extracted text', dossierMarkdown: '# old extracted Markdown', dossierExtractAttempt: { at: '2026-11-10T10:00:00Z' },
    };
    const portal = { url: sourceUrl, estimationMad: 100000 };
    const setup = fixture({ fresh: Buffer.from(zipSync({ 'RC.pdf': strToU8('new source') })), raw: { ...derived, detail: portal, unrelated: 'retain' } });
    const evidence = await checkDossierRevision(id, setup.deps);
    expect(evidence.state).toBe('updated');
    const active = setup.getRecord();
    for (const field of Object.keys(derived)) expect(active.raw[field]).toBeNull();
    expect(active.raw.detail).toEqual(portal);
    expect(active.raw.unrelated).toBe('retain');
    expect(active.estimationMad).toBe(100000);
    expect(active.cautionProvisoireMad).toBe(1000);
    const history = [...setup.objects].filter(([key]) => key.startsWith(`dossiers/${id}/revisions/${evidence.previousArchiveSha256}.derived-`) && key.endsWith('.json'));
    expect(history).toHaveLength(1);
    expect(JSON.parse(history[0]![1].toString())).toMatchObject({ sourceArchiveSha256: evidence.previousArchiveSha256, derived });
    expect(setup.update.mock.calls.find(([, , patch]) => Boolean(patch.dossier))?.[1]).toEqual({});
  });

  test('fails closed when the shared guard is unavailable and does not claim success after abort', async () => {
    const setup = fixture();
    setup.deps.openPortalAccess = async () => { throw new Error('private Redis failure'); };
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'verification_unavailable' });
    expect(setup.download).not.toHaveBeenCalled();
    const cancelled = fixture();
    const controller = new AbortController(); controller.abort();
    expect(await checkDossierRevision(id, cancelled.deps, controller.signal)).toMatchObject({ state: 'unavailable' });
    expect(cancelled.download).not.toHaveBeenCalled();
  });

  test('rejects an untrusted source before opening the portal guard', async () => {
    const setup = fixture();
    setup.deps.tenders.findById = vi.fn(async () => ({ id, sourceUrl: sourceUrl.replace('www.marchespublics.gov.ma', 'www.marchespublics.gov.ma.attacker.test'), raw: {} }) as never);
    expect(await checkDossierRevision(id, setup.deps)).toMatchObject({ state: 'unavailable', reason: 'invalid_source' });
    expect(setup.deps.openPortalAccess).not.toHaveBeenCalled();
    expect(setup.fetchImpl).not.toHaveBeenCalled();
  });

  test('sanitizes saved evidence and rejects mismatched or future proof', async () => {
    const setup = fixture();
    const evidence = await checkDossierRevision(id, setup.deps);
    const raw = { dossierRevision: { ...evidence, objectKey: 'private', password: 'private' } };
    expect(readSavedDossierRevision(raw, sourceUrl, now())).toEqual(evidence);
    expect(readSavedDossierRevision(raw, sourceUrl.replace('1058286', '1058287'), now())).toBeNull();
    expect(readSavedDossierRevision({ dossierRevision: { ...evidence, checkedAt: '2099-01-01' } }, sourceUrl, now())).toBeNull();
    expect(readSavedDossierRevision({ dossierRevision: { ...evidence, sourceArchiveSha256: 'bad' } }, sourceUrl, now())).toBeNull();
  });
});

describe('portal acquisition for extraction', () => {
  test('uses the anonymous transport and releases the guard', async () => {
    const setup = fixture();
    await expect(downloadAnonymousDossierForExtraction(sourceUrl, setup.deps)).resolves.toMatchObject({ bytes: original });
    expect(setup.download.mock.calls[0]?.[1]).toBeNull();
    expect(setup.fetchImpl).toHaveBeenCalledTimes(4);
    expect(setup.access.close).toHaveBeenCalledOnce();
    expect(setup.update).not.toHaveBeenCalled();
  });

  test('does not open portal access overnight or touch the source from cooldown', async () => {
    const setup = fixture({ cooldown: 60_000 });
    await expect(downloadAnonymousDossierForExtraction(sourceUrl, {
      ...setup.deps, now: () => new Date('2026-11-13T01:00:00Z'),
    })).rejects.toThrow(/fermeture/i);
    expect(setup.deps.openPortalAccess).not.toHaveBeenCalled();
    await expect(downloadAnonymousDossierForExtraction(sourceUrl, setup.deps)).rejects.toThrow(/pause/i);
    expect(setup.download).not.toHaveBeenCalled();
    expect(setup.access.close).toHaveBeenCalledOnce();
  });

  test('applies the shared cooldown when blocked and never falls back to an account', async () => {
    const setup = fixture();
    setup.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(downloadAnonymousDossierForExtraction(sourceUrl, setup.deps)).rejects.toThrow(/pause/i);
    expect(setup.fetchImpl).toHaveBeenCalledOnce();
    expect(setup.access.markBlocked).toHaveBeenCalledOnce();
    setup.download.mockRejectedValueOnce(new AnonymousDceUnavailableError());
    await expect(downloadAnonymousDossierForExtraction(sourceUrl, setup.deps)).rejects.toThrow(/depuis la fiche/i);
    expect(setup.download).toHaveBeenCalledTimes(2);
  });

  test('rejects a nonofficial source before contacting the portal', async () => {
    const setup = fixture();
    await expect(downloadAnonymousDossierForExtraction(sourceUrl.replace('www.marchespublics.gov.ma', 'example.com'), setup.deps)).rejects.toThrow(/lien officiel/i);
    expect(setup.deps.openPortalAccess).not.toHaveBeenCalled();
  });
});
