import type { DocumentKind, ValidityStatus } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';

// Alert thresholds in days before expiry (data-architecture §4), widest first.
const ALERT_LADDERS: Partial<Record<DocumentKind, readonly number[]>> = {
  attestation_fiscale: [60, 30, 14, 7],
  attestation_cnss: [60, 30, 14, 7],
  qualification_classification: [90, 60, 30],
  assurance_rc: [60, 30, 14],
  assurance_decennale: [60, 30, 14],
  assurance_at: [60, 30, 14],
};
const DEFAULT_LADDER: readonly number[] = [30, 14, 7];

export function ladderFor(kind: DocumentKind): readonly number[] {
  return ALERT_LADDERS[kind] ?? DEFAULT_LADDER;
}

export function computeStatus(
  kind: DocumentKind,
  expiresAt: Date | null | undefined,
  today: Date,
): ValidityStatus {
  if (!expiresAt) return 'no_expiry';
  const remaining = daysUntil(expiresAt, today);
  if (remaining < 0) return 'expired';
  const widestThreshold = ladderFor(kind)[0] ?? 0;
  return remaining <= widestThreshold ? 'expiring' : 'valid';
}

/** Alert tiers already reached (13 days left on a [60,30,14,7] ladder → [60,30,14]). */
export function dueAlerts(
  kind: DocumentKind,
  expiresAt: Date | null | undefined,
  today: Date,
): readonly number[] {
  if (!expiresAt) return [];
  const remaining = daysUntil(expiresAt, today);
  if (remaining < 0) return [];
  return ladderFor(kind).filter((threshold) => remaining <= threshold);
}

/** Kinds required for a typical AOO travaux dossier administratif (tender-lifecycle §3). */
export const BID_REQUIRED_KINDS: readonly DocumentKind[] = [
  'attestation_fiscale',
  'attestation_cnss',
  'qualification_classification',
  'registre_commerce',
  'statuts',
  'pouvoirs_signataire',
];

export interface ReadinessDoc {
  kind: DocumentKind;
  expiresAt?: Date | null;
}

export interface ReadinessReport {
  score: number;
  ready: boolean;
  missing: readonly DocumentKind[];
  expired: readonly DocumentKind[];
  expiring: readonly DocumentKind[];
}

const STATUS_RANK: Record<ValidityStatus, number> = {
  no_expiry: 3,
  valid: 3,
  expiring: 2,
  expired: 1,
};

function bestStatusFor(
  kind: DocumentKind,
  docs: readonly ReadinessDoc[],
  today: Date,
): ValidityStatus | null {
  const statuses = docs
    .filter((doc) => doc.kind === kind)
    .map((doc) => computeStatus(kind, doc.expiresAt ?? null, today));
  if (statuses.length === 0) return null;
  return statuses.reduce((best, status) =>
    STATUS_RANK[status] > STATUS_RANK[best] ? status : best,
  );
}

/** "Can we bid today without requesting any document?" — data-architecture §4. */
export function computeReadiness(
  docs: readonly ReadinessDoc[],
  today: Date,
  required: readonly DocumentKind[] = BID_REQUIRED_KINDS,
): ReadinessReport {
  const missing: DocumentKind[] = [];
  const expired: DocumentKind[] = [];
  const expiring: DocumentKind[] = [];
  let usable = 0;

  for (const kind of required) {
    const status = bestStatusFor(kind, docs, today);
    if (status === null) {
      missing.push(kind);
      continue;
    }
    if (status === 'expired') {
      expired.push(kind);
      continue;
    }
    if (status === 'expiring') expiring.push(kind);
    usable += 1;
  }

  const score =
    required.length === 0 ? 100 : Math.round((usable / required.length) * 100);
  return {
    score,
    ready: missing.length === 0 && expired.length === 0,
    missing,
    expired,
    expiring,
  };
}
