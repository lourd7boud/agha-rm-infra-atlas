import {
  canonicalReferenceKey,
  normalizeCompanyName,
  refBuyerKey,
} from '../intel/intel.repository';
import type { PortalSubmissionRecord } from './portal.repository';

/**
 * Outcome reconciliation (READ-ONLY) — joins OUR own soumissions ("Mes réponses")
 * with the public attribution results the Result Miner already mined into
 * intel.competitor_bid. For each submission it answers the one question the
 * direction cares about: did we win, lose, are we still waiting, or did we
 * withdraw?
 *
 * Pure aggregation: takes the two record lists as inputs and returns a verdict
 * per submission. No HTTP, no DB, no writes — it never touches
 * tender.submission_outcome (that destructive derivation is a later phase). The
 * thin service in portal-outcome.service.ts loads the lists from the two repos
 * and delegates here.
 */

/**
 * Our own raison sociale, env-overridable. The winner attribution is matched
 * against this (folded with the same legal-form-aware normalizer the competitor
 * map uses) so "AGHID CONSTRUCTION", "AGHID CONSTRUCTION SARL" and accent/case
 * variants all resolve to us.
 */
export const OUR_COMPANY_NAME =
  process.env.PORTAL_OUR_COMPANY?.trim() || 'AGHID CONSTRUCTION';

/** Verdict for one of our soumissions against the public results. */
export type SubmissionOutcomeStatus = 'gagne' | 'perdu' | 'en_attente' | 'retire';

/** The winner side of a published attribution, keyed by canonical (référence + acheteur). */
export interface OutcomeWinner {
  reference: string;
  /** Raison sociale of the attributaire as read from the notice/PV. */
  bidderName: string;
  amountMad?: number;
  /** Acheteur of the attribution — scopes the match to the SAME buyer so a
   *  generic référence (NN/2026) reused by another organisme never mis-attributes. */
  buyerName?: string;
}

export interface SubmissionOutcome {
  submission: PortalSubmissionRecord;
  outcome: SubmissionOutcomeStatus;
  /** Raison sociale of the winner when a published attribution exists. */
  winnerName?: string;
  /** Winning montant (MAD) when the notice/PV carried it. */
  winnerAmountMad?: number;
}

/**
 * Canonical join key for a market référence. Defined once in intel.repository.ts
 * (alongside the company-name normalizer) so the domain, the in-memory matcher,
 * and the Drizzle SQL canonicalizer in findWinnersByReferences share ONE fold.
 * Re-exported here because the result crawler and tests import it via the domain.
 */
export { canonicalReferenceKey };

/**
 * Indexes the winner bids by canonical (référence + acheteur), keeping the first
 * winner seen for each market+buyer. Only `isWinner` rows from the public results
 * belong here — the écartés (losing soumissionnaires the PV also records) never
 * decide an outcome. Keying on reference ALONE mis-attributed a stranger's winner
 * to our soumission whenever a generic référence (NN/2026) was reused.
 */
function indexWinnersByReference(
  winners: readonly OutcomeWinner[],
): Map<string, OutcomeWinner> {
  const byKey = new Map<string, OutcomeWinner>();
  for (const winner of winners) {
    // Skip winners with no usable référence; buyer may be blank (keys as "…|").
    if (canonicalReferenceKey(winner.reference).length === 0) continue;
    const key = refBuyerKey(winner.reference, winner.buyerName ?? '');
    if (byKey.has(key)) continue;
    byKey.set(key, winner);
  }
  return byKey;
}

/** Resolves one submission's verdict against the indexed public winners. */
function resolveOutcome(
  submission: PortalSubmissionRecord,
  winnersByKey: Map<string, OutcomeWinner>,
  ourNormalized: string,
  now: Date,
): SubmissionOutcome {
  // A withdrawn soumission has no winner question to ask — we pulled out.
  if (submission.withdrawnAt) return { submission, outcome: 'retire' };

  // An attribution can only exist AFTER the submission deadline + opening. While
  // the deadline is still ahead, the market is being adjudicated — never claim a
  // result (a stranger's winner on a reused générique référence used to leak in).
  if (submission.deadlineAt && submission.deadlineAt.getTime() >= now.getTime()) {
    return { submission, outcome: 'en_attente' };
  }

  const winner = winnersByKey.get(
    refBuyerKey(submission.reference, submission.organisme ?? ''),
  );
  // No published attribution for THIS market+buyer yet → still being adjudicated.
  if (!winner) return { submission, outcome: 'en_attente' };

  const isOurs = normalizeCompanyName(winner.bidderName) === ourNormalized;
  return {
    submission,
    outcome: isOurs ? 'gagne' : 'perdu',
    winnerName: winner.bidderName,
    ...(winner.amountMad !== undefined
      ? { winnerAmountMad: winner.amountMad }
      : {}),
  };
}

export interface ComputeOutcomesOptions {
  /** Override our raison sociale (defaults to OUR_COMPANY_NAME). */
  ourCompanyName?: string;
  /** Clock for the deadline guard — a submission past this is eligible for a
   *  verdict; still-open ones stay 'en_attente'. Defaults to the current time. */
  now?: Date;
}

/**
 * Pure reconciliation: returns one verdict per submission, preserving input
 * order. 'retire' when withdrawnAt is set; otherwise the winning competitor_bid
 * for that référence decides — its attributaire matching OUR company →
 * 'gagne', any other winner → 'perdu', no published winner → 'en_attente'.
 */
export function computeSubmissionOutcomes(
  submissions: readonly PortalSubmissionRecord[],
  winners: readonly OutcomeWinner[],
  options: ComputeOutcomesOptions = {},
): SubmissionOutcome[] {
  const ourNormalized = normalizeCompanyName(
    options.ourCompanyName ?? OUR_COMPANY_NAME,
  );
  const now = options.now ?? new Date();
  const winnersByKey = indexWinnersByReference(winners);
  return submissions.map((submission) =>
    resolveOutcome(submission, winnersByKey, ourNormalized, now),
  );
}
