import { parsePmmpDeadline } from '@atlas/contracts';
import { isPmmpUrl } from '../../lib/pmmp-hours';
import { pmmpIdentity } from '../watch/watch-audit';
import { readPortalDetail } from './portal-detail';
import type { TenderRecord } from './tender.repository';
import { readSavedDossierRevision } from './dossier-revision-check';

export type SamirArchiveEvidence =
  | { state: 'not_cached' | 'unavailable' }
  | { state: 'missing_object'; filename: string; cachedAt: string }
  | { state: 'available'; filename: string; cachedAt: string; integrity?: 'matched' | 'mismatch' | 'unavailable' };

type Check = 'matched' | 'conflict' | 'unverified';
type SourceState = 'no_official_source' | 'missing_snapshot' | 'mismatched_snapshot' | 'matched_snapshot';

function officialIdentity(url: unknown): string | null {
  return typeof url === 'string' && isPmmpUrl(url) ? pmmpIdentity(url) : null;
}

function savedDetailUrl(raw: TenderRecord['raw'] | undefined): unknown {
  const detail = raw?.detail;
  return detail && typeof detail === 'object' && 'url' in detail ? detail.url : null;
}

export function hasMismatchedPortalDetail(sourceUrl: unknown, raw: TenderRecord['raw'] | undefined): boolean {
  const identity = officialIdentity(sourceUrl);
  const detailUrl = savedDetailUrl(raw);
  return Boolean(identity && detailUrl && officialIdentity(detailUrl) !== identity);
}

function compare(actual: number | undefined, observed: number | undefined | null): Check {
  if (actual == null || observed == null || !Number.isFinite(actual) || !Number.isFinite(observed)) {
    return 'unverified';
  }
  return actual === observed ? 'matched' : 'conflict';
}

/** Verify saved evidence. A current official DCE revision requires separate proof. */
export function buildSamirReview(
  record: Pick<TenderRecord, 'sourceUrl' | 'deadlineAt' | 'estimationMad' | 'cautionProvisoireMad' | 'raw'>,
  archive: SamirArchiveEvidence,
  now = new Date(),
) {
  const identity = officialIdentity(record.sourceUrl);
  const detailUrl = savedDetailUrl(record.raw);
  const detailIdentity = officialIdentity(detailUrl);
  const portal = readPortalDetail(record.raw);
  const fetchedAt = portal?.fetchedAt;
  const validTimestamp = fetchedAt && Number.isFinite(Date.parse(fetchedAt)) && Date.parse(fetchedAt) <= now.getTime();
  const state: SourceState = !identity ? 'no_official_source'
    : hasMismatchedPortalDetail(record.sourceUrl, record.raw) ? 'mismatched_snapshot'
      : detailIdentity === identity && validTimestamp ? 'matched_snapshot'
        : 'missing_snapshot';
  const matchedDetail = state === 'matched_snapshot' ? portal : null;
  const officialDeadline = matchedDetail?.deadline ? parsePmmpDeadline(matchedDetail.deadline) : null;
  const revision = readSavedDossierRevision(record.raw, record.sourceUrl, now);
  const complement = matchedDetail?.dceComplement && fetchedAt
    ? { state: matchedDetail.dceComplement, observedAt: fetchedAt }
    : undefined;
  const confirmed = archive.state === 'available' && archive.integrity === 'matched' && complement?.state !== 'listed' && revision &&
    ['unchanged', 'updated', 'downloaded'].includes(revision.state);

  return {
    checkedAt: now.toISOString(),
    source: { identity, state, observedAt: state === 'matched_snapshot' ? fetchedAt ?? null : null },
    checks: {
      deadline: compare(record.deadlineAt.getTime(), officialDeadline?.getTime()),
      caution: compare(record.cautionProvisoireMad, matchedDetail?.cautionProvisoireMad),
      estimate: compare(record.estimationMad, matchedDetail?.estimationMad),
    },
    documents: { ...archive, currentRevision: confirmed ? 'confirmed_as_of' as const : 'unverified' as const,
      ...(revision ? { revision } : {}), ...(complement ? { complement } : {}) },
  };
}
