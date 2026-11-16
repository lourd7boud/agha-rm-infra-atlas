import { Queue } from 'bullmq';
import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { nextPmmpOpening } from '../../lib/pmmp-hours';
import { AnonymousDceUnavailableError, downloadDce, parsePortalRef } from '../watch/dossier.crawler';
import { PortalAuthSession, portalAuthConfigFromEnv } from '../portal/portal-auth';
import type { ObjectStorage } from '../vault/storage';
import type { TenderRepository } from './tender.repository';
import { assertDossierArchiveSize, MAX_DOSSIER_ARCHIVE_BYTES } from './dossier-archive-safety';
import { compareDceArchives } from './dossier-revision';

const COOLDOWN_KEY = 'atlas:watch:portal-cooldown';
const BLOCK_DELAY_MS = 30 * 60_000;
const logger = new Logger('DossierRevision');
// Written by DossierExtractionService; structured BPU, qualifications and legal
// conditions all live inside dossierExtraction. Portal-derived fields are separate.
const EXTRACTION_FIELDS = ['dossierExtraction', 'dossierText', 'dossierMarkdown', 'dossierExtractAttempt'] as const;

export interface RevisionEvidence {
  version: 1;
  officialIdentity: string | null;
  checkedAt: string;
  state: 'unchanged' | 'updated' | 'downloaded' | 'unavailable';
  reason?: 'scheduled_closure' | 'cooldown' | 'blocked' | 'anonymous_unavailable' | 'withdrawal_unconfirmed' | 'download_failed' | 'invalid_source' | 'verification_unavailable';
  retryAt?: string;
  previousArchiveSha256?: string;
  sourceArchiveSha256?: string;
  documentsIdentical?: boolean;
  mode?: 'anonymous' | 'account';
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
}

/** A repacked source can match the documents while the earlier ZIP remains active. */
export function comparedArchiveSha256(revision: RevisionEvidence | null): string | undefined {
  if (!revision || revision.state === 'unavailable') return undefined;
  return revision.state === 'unchanged' ? revision.previousArchiveSha256 : revision.sourceArchiveSha256;
}

export interface RevisionPortalAccess {
  remainingCooldown(): Promise<number>;
  markBlocked(): Promise<void>;
  close(): Promise<void>;
}

export interface RevisionCheckDependencies {
  tenders: TenderRepository;
  storage: ObjectStorage;
  /** Serializes only the final read/replace/proof transaction, not portal I/O. */
  commit<T>(operation: () => Promise<T>): Promise<T>;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  download?: typeof downloadDce;
  openPortalAccess?: () => Promise<RevisionPortalAccess>;
  usePortalAccount?: boolean;
  authenticatedTransport?: (guardedFetch: typeof fetch) => Promise<typeof fetch>;
}

class RevisionPaused extends Error {
  constructor(readonly reason: NonNullable<RevisionEvidence['reason']>, readonly retryAt?: string) { super(reason); }
}

const WITHDRAWAL_TARGET = 'ctl0$CONTENU_PAGE$validateButton';

function officialUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['www.marchespublics.gov.ma', 'marchespublics.gov.ma'].includes(url.hostname);
  } catch { return false; }
}

function officialPortalRef(sourceUrl: string | null | undefined) {
  if (!sourceUrl || !officialUrl(sourceUrl)) return null;
  const ref = parsePortalRef(sourceUrl);
  return ref && /^\d{1,20}$/.test(ref.refConsultation) && /^[a-z\d_]{1,40}$/i.test(ref.orgAcronyme) ? ref : null;
}

/** Only source-matched, dated public evidence may be shown as a saved check. */
export function readSavedDossierRevision(raw: Record<string, unknown> | null, sourceUrl: string | null | undefined, now = new Date()): RevisionEvidence | null {
  const ref = officialPortalRef(sourceUrl);
  const value = raw?.dossierRevision;
  if (!ref || !value || typeof value !== 'object') return null;
  const item = value as RevisionEvidence;
  if (item.version !== 1 || item.officialIdentity !== `${ref.refConsultation}/${ref.orgAcronyme}` ||
      typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt)) || Date.parse(item.checkedAt) > now.getTime() ||
      !['unchanged', 'updated', 'downloaded', 'unavailable'].includes(item.state)) return null;
  const lists = [item.changedFiles, item.addedFiles, item.removedFiles];
  if (lists.some(list => !Array.isArray(list) || list.length > 4000 || list.some(name => typeof name !== 'string' || !name || Buffer.byteLength(name) > 1024))) return null;
  for (const hash of [item.previousArchiveSha256, item.sourceArchiveSha256]) {
    if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) return null;
  }
  if (item.retryAt !== undefined && (typeof item.retryAt !== 'string' || !Number.isFinite(Date.parse(item.retryAt)))) return null;
  if (item.documentsIdentical !== undefined && typeof item.documentsIdentical !== 'boolean') return null;
  if (item.mode !== undefined && item.mode !== 'anonymous' && item.mode !== 'account') return null;
  if (item.state === 'unavailable') {
    if (!['scheduled_closure', 'cooldown', 'blocked', 'anonymous_unavailable', 'withdrawal_unconfirmed', 'download_failed', 'invalid_source', 'verification_unavailable'].includes(item.reason ?? '')) return null;
  } else if (!item.sourceArchiveSha256 || item.reason ||
      (item.state === 'unchanged' && (!item.previousArchiveSha256 || item.documentsIdentical !== true)) ||
      (item.state === 'updated' && (!item.previousArchiveSha256 || item.documentsIdentical !== false)) ||
      (item.state === 'downloaded' && (item.previousArchiveSha256 !== undefined || item.documentsIdentical !== false))) return null;
  return {
    version: 1, officialIdentity: item.officialIdentity, checkedAt: item.checkedAt, state: item.state,
    ...(item.reason ? { reason: item.reason } : {}), ...(item.retryAt ? { retryAt: item.retryAt } : {}),
    ...(item.previousArchiveSha256 ? { previousArchiveSha256: item.previousArchiveSha256 } : {}),
    ...(item.sourceArchiveSha256 ? { sourceArchiveSha256: item.sourceArchiveSha256 } : {}),
    ...(item.documentsIdentical === undefined ? {} : { documentsIdentical: item.documentsIdentical }),
    ...(item.mode ? { mode: item.mode } : {}),
    changedFiles: [...item.changedFiles], addedFiles: [...item.addedFiles], removedFiles: [...item.removedFiles],
  };
}

async function openPortalAccess(): Promise<RevisionPortalAccess> {
  if (!process.env.REDIS_URL) throw new Error('Portal guard unavailable');
  const url = new URL(process.env.REDIS_URL);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Portal guard unavailable');
  const queue = new Queue('watch', { connection: {
    host: url.hostname, port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null,
  } });
  queue.on('error', () => {}); // Request methods fail closed; never print connection credentials.
  try {
    const redis = await queue.client;
    return {
      async remainingCooldown() {
        const value = await redis.get(COOLDOWN_KEY);
        if (value === null) return 0;
        const until = Number(value);
        if (!Number.isFinite(until)) throw new Error('Portal guard unavailable');
        return Math.max(0, until - Date.now());
      },
      async markBlocked() { await redis.set(COOLDOWN_KEY, String(Date.now() + BLOCK_DELAY_MS), { PX: BLOCK_DELAY_MS }); },
      async close() { await queue.close(); },
    };
  } catch (error) { await queue.close().catch(() => {}); throw error; }
}

function checkOpening(now: () => Date, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const opening = nextPmmpOpening(now());
  if (opening) throw new RevisionPaused('scheduled_closure', opening.toISOString());
}

function guardPortalRequests(access: RevisionPortalAccess, now: () => Date, fetchImpl: typeof fetch, signal?: AbortSignal) {
  const pause = async () => {
    checkOpening(now, signal);
    const remaining = await access.remainingCooldown();
    if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Portal guard unavailable');
    if (remaining > 0) throw new RevisionPaused('cooldown', new Date(now().getTime() + remaining).toISOString());
  };
  const transport = (beforeDispatch?: (init?: RequestInit, signal?: AbortSignal) => Promise<void>): typeof fetch =>
    async (input, init) => {
      await pause();
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (!officialUrl(target)) throw new Error('Unofficial download target');
      const inputSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const requestSignal = signal && inputSignal ? AbortSignal.any([signal, inputSignal]) : signal ?? inputSignal;
      await beforeDispatch?.(init, requestSignal);
      const response = await fetchImpl(input, { ...init, redirect: 'manual', signal: requestSignal });
      if ([403, 429, 433, 888].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        await access.markBlocked();
        throw new RevisionPaused('blocked', new Date(now().getTime() + BLOCK_DELAY_MS).toISOString());
      }
      return response;
    };
  return { pause, transport };
}

type PortalDownloadDependencies = Pick<RevisionCheckDependencies, 'now' | 'fetchImpl' | 'download' | 'openPortalAccess'>;

/** Cache-miss extraction can use the portal's explicit anonymous mode only. */
export async function downloadAnonymousDossierForExtraction(sourceUrl: string | null | undefined, deps: PortalDownloadDependencies = {}) {
  const ref = officialPortalRef(sourceUrl);
  if (!ref) throw new BadRequestException('Aucun lien officiel exploitable pour ce marché.');
  const now = deps.now ?? (() => new Date());
  let access: RevisionPortalAccess | undefined;
  try {
    checkOpening(now);
    access = await (deps.openPortalAccess ?? openPortalAccess)();
    const guard = guardPortalRequests(access, now, deps.fetchImpl ?? fetch);
    await guard.pause();
    return await (deps.download ?? downloadDce)(ref, null, guard.transport());
  } catch (error) {
    if (error instanceof AnonymousDceUnavailableError) {
      throw new ServiceUnavailableException('Ce DCE exige un retrait depuis la fiche du marché.');
    }
    if (error instanceof RevisionPaused) {
      throw new ServiceUnavailableException(error.reason === 'scheduled_closure'
        ? 'Fermeture nocturne du portail. Réessayez après la réouverture.'
        : 'Accès au portail en pause. Réessayez dans quelques minutes.');
    }
    logger.warn('Extraction: échec de la récupération anonyme du DCE.');
    throw new ServiceUnavailableException('Le téléchargement anonyme du DCE a échoué. Réessayez depuis la fiche du marché.');
  } finally {
    await access?.close().catch(() => {});
  }
}

function isMissingObject(error: unknown): boolean {
  const item = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return item?.name === 'NoSuchKey' || item?.name === 'NotFound' || item?.$metadata?.httpStatusCode === 404;
}

async function readArchive(storage: ObjectStorage, key: string): Promise<Buffer> {
  const object = await storage.getObject(key);
  if (object.sizeBytes !== undefined) assertDossierArchiveSize(object.sizeBytes);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of object.body) {
    size += chunk.byteLength;
    if (size > MAX_DOSSIER_ARCHIVE_BYTES) throw new Error('Archive limit exceeded');
    chunks.push(Buffer.from(chunk));
  }
  assertDossierArchiveSize(size);
  return Buffer.concat(chunks);
}

/** Explicit anonymous source recheck; neither a cached ZIP nor an error confirms freshness. */
export async function checkDossierRevision(
  tenderId: string,
  deps: RevisionCheckDependencies,
  signal?: AbortSignal,
): Promise<RevisionEvidence> {
  const now = deps.now ?? (() => new Date());
  const mode = deps.usePortalAccount ? 'account' : 'anonymous';
  let evidence: RevisionEvidence = {
    version: 1, officialIdentity: null, checkedAt: now().toISOString(), state: 'unavailable',
    mode, changedFiles: [], addedFiles: [], removedFiles: [],
  };
  let access: RevisionPortalAccess | undefined;
  let withdrawalAttempted = false;
  let outstandingWithdrawal: RevisionEvidence | null = null;
  let phase: 'verification' | 'download' | 'commit' = 'verification';
  const persist = async (value: RevisionEvidence) => {
    const saved = await deps.tenders.updateEnrichment(tenderId, {}, { dossierRevision: value });
    if (!saved) throw new Error('Revision proof unavailable');
    return value;
  };
  try {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenderId)) throw new RevisionPaused('invalid_source');
    const tender = await deps.tenders.findById(tenderId);
    const ref = officialPortalRef(tender?.sourceUrl);
    if (!tender || !ref) throw new RevisionPaused('invalid_source');
    evidence.officialIdentity = `${ref.refConsultation}/${ref.orgAcronyme}`;
    const previous = readSavedDossierRevision(tender.raw, tender.sourceUrl, now());
    if (previous?.reason === 'withdrawal_unconfirmed') {
      outstandingWithdrawal = previous;
      if (deps.usePortalAccount) return previous;
    }
    checkOpening(now, signal);
    access = await (deps.openPortalAccess ?? openPortalAccess)();
    const { pause, transport: makeTransport } = guardPortalRequests(access, now, deps.fetchImpl ?? fetch, signal);
    await pause();
    const guardedFetch = makeTransport(mode === 'account' ? async (init, requestSignal) => {
      const body = init?.body;
      if (init?.method === 'POST' && typeof body === 'string' &&
          new URLSearchParams(body).get('PRADO_POSTBACK_TARGET') === WITHDRAWAL_TARGET) {
        if (withdrawalAttempted) throw new Error('Repeated withdrawal submission refused');
        // Write the uncertain outcome before sending: the process may lose the
        // response or stop before the archive can be compared and saved.
        await deps.commit(async () => {
          const current = await deps.tenders.findById(tenderId);
          if (!current || current.sourceUrl !== tender.sourceUrl) throw new Error('Source changed before withdrawal');
          const saved = readSavedDossierRevision(current.raw, current.sourceUrl, now());
          if (saved?.reason === 'withdrawal_unconfirmed') {
            outstandingWithdrawal = saved;
            throw new Error('Previous withdrawal outcome still unconfirmed');
          }
          await pause();
          requestSignal?.throwIfAborted();
          await persist({ ...evidence, checkedAt: now().toISOString(), reason: 'withdrawal_unconfirmed' });
        });
        withdrawalAttempted = true;
      }
    } : undefined);
    phase = 'download';
    const transport = deps.usePortalAccount ? await (deps.authenticatedTransport ?? (transport =>
      new PortalAuthSession({ ...portalAuthConfigFromEnv(), fetchImpl: transport }).authenticatedTransport()
    ))(guardedFetch) : guardedFetch;
    const fresh = await (deps.download ?? downloadDce)(ref, null, transport, {
      signal, usePortalAccount: deps.usePortalAccount,
      onStep: step => logger.log(JSON.stringify({ consultation: evidence.officialIdentity, mode, ...step })),
    });
    signal?.throwIfAborted();
    assertDossierArchiveSize(fresh.bytes.byteLength);
    // Validate incoming content even when no local archive exists yet.
    const incoming = compareDceArchives(fresh.bytes, fresh.bytes);
    phase = 'commit';
    return await deps.commit(async () => {
      signal?.throwIfAborted();
      const current = await deps.tenders.findById(tenderId);
      if (!current || current.sourceUrl !== tender.sourceUrl) throw new Error('Source changed during revision check');
      const canonical = `dossiers/${tenderId}.zip`;
      const meta = current.raw?.dossier as { objectKey?: unknown } | undefined;
      if (meta && meta.objectKey !== canonical) throw new Error('Unexpected cached archive identity');
      let previous: Buffer | null = null;
      try { previous = await readArchive(deps.storage, canonical); }
      catch (error) { if (meta || !isMissingObject(error)) throw error; }
      const compared = previous ? compareDceArchives(previous, fresh.bytes) : incoming;
      evidence = {
        ...evidence, checkedAt: now().toISOString(),
        state: previous ? compared.identicalDocuments ? 'unchanged' : 'updated' : 'downloaded',
        ...(previous ? { previousArchiveSha256: compared.previousArchiveSha256 } : {}),
        sourceArchiveSha256: compared.nextArchiveSha256,
        documentsIdentical: Boolean(previous && compared.identicalDocuments),
        changedFiles: previous ? compared.changed : [], addedFiles: previous ? compared.added : [], removedFiles: previous ? compared.removed : [],
      };
      await deps.storage.put(`dossiers/${tenderId}/revisions/${compared.nextArchiveSha256}.zip`, fresh.bytes, 'application/zip');
      if (previous && compared.identicalDocuments) {
        await deps.storage.delete(`dossiers/${tenderId}.md`);
        return persist(evidence);
      }
      if (previous) await deps.storage.put(`dossiers/${tenderId}/revisions/${compared.previousArchiveSha256}.zip`, previous, 'application/zip');
      const derived = Object.fromEntries(EXTRACTION_FIELDS
        .filter(field => Object.hasOwn(current.raw ?? {}, field))
        .map(field => [field, current.raw![field]]));
      if (Object.keys(derived).length) {
        const snapshot = Buffer.from(JSON.stringify({
          version: 1, officialIdentity: evidence.officialIdentity, archivedAt: evidence.checkedAt,
          sourceArchiveSha256: previous ? compared.previousArchiveSha256 : null, derived,
        }), 'utf8');
        const digest = createHash('sha256').update(snapshot).digest('hex');
        const source = previous ? compared.previousArchiveSha256 : 'unknown-source';
        await deps.storage.put(`dossiers/${tenderId}/revisions/${source}.derived-${digest}.json`, snapshot, 'application/json');
      }
      // Invalidate before activation: if deletion fails, canonical bytes and their
      // metadata remain on the old revision. The caller holds the archive gate.
      await deps.storage.delete(`dossiers/${tenderId}.md`);
      let replaced = false;
      try {
        await deps.storage.put(canonical, fresh.bytes, 'application/zip');
        replaced = true;
        const saved = await deps.tenders.updateEnrichment(tenderId, {}, {
          dossier: { objectKey: canonical, filename: fresh.filename, sizeBytes: fresh.bytes.byteLength,
            downloadedAt: evidence.checkedAt, downloadMode: mode },
          dossierRevision: evidence,
          ...Object.fromEntries(EXTRACTION_FIELDS.map(field => [field, null])),
        });
        if (!saved) throw new Error('Revision metadata unavailable');
      } catch (error) {
        if (replaced) {
          if (previous) await deps.storage.put(canonical, previous, 'application/zip');
          else await deps.storage.delete(canonical);
        }
        throw error;
      }
      return evidence;
    });
  } catch (error) {
    if (outstandingWithdrawal) return outstandingWithdrawal;
    const paused = error instanceof RevisionPaused ? error : null;
    const anonymousUnavailable = error instanceof AnonymousDceUnavailableError;
    evidence = {
      version: 1, officialIdentity: evidence.officialIdentity, checkedAt: now().toISOString(), state: 'unavailable',
      mode,
      reason: withdrawalAttempted ? 'withdrawal_unconfirmed' : paused?.reason ??
        (anonymousUnavailable ? 'anonymous_unavailable' : phase === 'download' ? 'download_failed' : 'verification_unavailable'),
      ...(anonymousUnavailable || withdrawalAttempted ? {} : { retryAt: paused?.retryAt ?? new Date(now().getTime() + 15 * 60_000).toISOString() }),
      changedFiles: [], addedFiles: [], removedFiles: [],
    };
    try { return await persist(evidence); }
    catch { return withdrawalAttempted ? evidence : { ...evidence, reason: 'verification_unavailable' }; }
  } finally { await access?.close().catch(() => {}); }
}
