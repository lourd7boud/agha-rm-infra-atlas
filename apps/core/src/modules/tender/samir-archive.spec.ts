import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryObjectStorage } from '../vault/storage';
import { DossierService } from './dossier.service';
import { PDFParse } from 'pdf-parse';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { buildFullDossierMarkdown } from './dossier-fulltext';

const id = '11111111-1111-4111-8111-111111111111';
const raw = { dossier: {
  objectKey: `dossiers/${id}.zip`, filename: 'DAO.zip', sizeBytes: 100,
  downloadedAt: '2026-11-10T22:45:13.155Z',
} };

describe('Samir cache-only archive check', () => {
  it('serves a source-page link only for the same exact path and file bytes', async () => {
    const name = 'Lot 1/RC.pdf';
    const original = Buffer.from('original PDF content');
    const hash = createHash('sha256').update(original).digest('hex');
    let archive = zipSync({ [name]: original });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(Buffer.from(archive)));
    const service = new DossierService({ findById: async () => ({ id, raw }) } as never, {
      exists: async () => true, presignedGetUrl: async () => 'http://saved-archive.test/DAO.zip',
    } as never);
    try {
      const leased = await service.acquireDossierFile(id, name, undefined, { expectedSha256: hash });
      try { expect(leased.file.bytes).toEqual(original); } finally { leased.release(); }
      archive = zipSync({ 'Lot 2/RC.pdf': original });
      await expect(service.acquireDossierFile(id, name, undefined, { expectedSha256: hash })).rejects.toMatchObject({ status: 404 });
      archive = zipSync({ [name]: Buffer.from('revised PDF content') });
      await expect(service.acquireDossierFile(id, name, undefined, { expectedSha256: hash })).rejects.toMatchObject({ status: 409 });
    } finally { fetch.mockRestore(); }
  });
  it('lists saved readability only when its archive fingerprint matches', async () => {
    const zip = zipSync({ 'AVIS.pdf': strToU8('source text') });
    const { markdown } = await buildFullDossierMarkdown(zip, async bytes => strFromU8(bytes));
    let savedMarkdown = markdown;
    const storage = {
      presignedGetUrl: async () => 'http://saved-archive.test/DAO.zip',
      getObject: async () => ({ body: (async function* () { yield Buffer.from(savedMarkdown); })() }),
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(Buffer.from(zip)));
    const service = new DossierService({ findById: async () => ({ id, raw }) } as never, storage as never);
    try {
      expect(await service.listDossierFiles(id)).toMatchObject([{ name: 'AVIS.pdf', readability: 'readable' }]);
      savedMarkdown = markdown.replace(/"archiveSha256":"[a-f0-9]+"/, `"archiveSha256":"${'0'.repeat(64)}"`);
      expect((await service.listDossierFiles(id))[0]?.readability).toBeUndefined();
    } finally { fetch.mockRestore(); }
  });
  it('keeps legacy Markdown explicitly unverified without acquiring an absent archive', async () => {
    const put = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const storage = { getObject: async () => ({ body: (async function* () { yield Buffer.from('## AVIS.pdf\nAncien texte conservé'); })() }), put };
    const service = new DossierService({ findById: async () => ({ id, raw: null }) } as never, storage as never);
    try {
      const markdown = await service.getDossierMarkdown(id);
      expect(markdown).toContain('COUVERTURE NON VÉRIFIÉE — CACHE ANCIEN');
      expect(markdown).toContain('Ancien texte conservé');
      expect(fetch).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('checks local storage without asking the portal or tender repository', async () => {
    const exists = vi.fn(async () => true);
    const repo = { findById: vi.fn() };
    const service = new DossierService(repo as never, { exists } as never);
    expect(await service.inspectCachedArchive(id, raw)).toMatchObject({ state: 'available', filename: 'DAO.zip' });
    expect(exists).toHaveBeenCalledWith(raw.dossier.objectKey, expect.any(AbortSignal));
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('checks the archive actually served against the saved comparison and detects equal-length replacement', async () => {
    const storage = new InMemoryObjectStorage();
    const original = Buffer.alloc(100, 'a');
    const sha = createHash('sha256').update(original).digest('hex');
    const sourceUrl = 'https://www.marchespublics.gov.ma/index.php?refConsultation=1058286&orgAcronyme=o8p';
    const dossierRevision = { version: 1, officialIdentity: '1058286/o8p', checkedAt: '2026-11-13T20:00:00Z',
      state: 'unchanged', previousArchiveSha256: sha, sourceArchiveSha256: 'f'.repeat(64),
      documentsIdentical: true, changedFiles: [], addedFiles: [], removedFiles: [] };
    const record = { sourceUrl, raw: { ...raw, dossierRevision } };
    const service = new DossierService({ findById: async () => record } as never, storage);
    await storage.put(raw.dossier.objectKey, original, 'application/zip');
    expect(await service.inspectCachedArchive(id, record.raw, sha)).toMatchObject({ state: 'available', integrity: 'matched' });
    expect(await service.savedRevision(id)).toMatchObject({ state: 'unchanged' });
    await storage.put(raw.dossier.objectKey, Buffer.alloc(100, 'b'), 'application/zip');
    expect(await service.inspectCachedArchive(id, record.raw, sha)).toMatchObject({ state: 'available', integrity: 'mismatch' });
    expect(await service.savedRevision(id)).toMatchObject({ state: 'unavailable', reason: 'archive_unverified' });
    expect(record.raw.dossierRevision).toBe(dossierRevision);
  });

  it('distinguishes no metadata, missing object, invalid key and storage failure', async () => {
    const exists = vi.fn(async () => false);
    const service = new DossierService({} as never, { exists } as never);
    expect(await service.inspectCachedArchive(id, null)).toEqual({ state: 'not_cached' });
    expect(exists).not.toHaveBeenCalled();
    expect(await service.inspectCachedArchive(id, raw)).toMatchObject({ state: 'missing_object' });
    exists.mockRejectedValueOnce(new Error('internal storage error'));
    expect(await service.inspectCachedArchive(id, raw)).toEqual({ state: 'unavailable' });
    expect(await service.inspectCachedArchive(id, { dossier: { ...raw.dossier, objectKey: 'another-project.zip' } }))
      .toEqual({ state: 'unavailable' });
  });

  it('cannot trigger a portal download when inspecting a file without a cached archive', async () => {
    const exists = vi.fn();
    const put = vi.fn();
    const service = new DossierService({ findById: async () => ({ id, raw: null }) } as never, { exists, put } as never);
    await expect(service.inspectCachedFile(id, 'RC.pdf')).rejects.toThrow('Archive DCE absente');
    expect(exists).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('releases the shared file lease when a stalled PDF is cancelled', async () => {
    const service = new DossierService({} as never, {} as never);
    const release = vi.fn();
    vi.spyOn(service, 'acquireDossierFile').mockResolvedValue({
      file: { bytes: Buffer.from('%PDF-1.7\n'), filename: 'RC.pdf', mime: 'application/pdf' }, release,
    });
    const getText = vi.spyOn(PDFParse.prototype, 'getText').mockImplementation(() => new Promise(() => {}));
    const destroy = vi.spyOn(PDFParse.prototype, 'destroy').mockResolvedValue(undefined);
    try {
      const controller = new AbortController();
      const pending = service.inspectCachedFile(id, 'RC.pdf', controller.signal);
      await vi.waitFor(() => expect(getText).toHaveBeenCalledOnce());
      controller.abort();
      expect(await pending).toMatchObject({ state: 'failed', failureCode: 'inspection_aborted' });
      expect(destroy).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      getText.mockRestore(); destroy.mockRestore();
    }
  });
});
