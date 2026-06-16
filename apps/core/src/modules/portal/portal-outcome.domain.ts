import {
  canonicalReferenceKey,
  normalizeCompanyName,
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

/** The winner side of a published attribution, keyed by canonical référence. */
export interface OutcomeWinner {
  reference: string;
  /** Raison sociale of the attributaire as read from the notice/PV. */
  bidderName: string;
  amountMad?: number;
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
 * Indexes the winner bids by canonical référence, keeping the first winner seen
 * for each market. Only `isWinner` rows from the public results belong here —
 * the écartés (losing soumissionnaires the PV also records) never decide an
 * outcome.
 */
function indexWinnersByReference(
  winners: readonly OutcomeWinner[],
): Map<string, OutcomeWinner> {
  const byReference = new Map<string, OutcomeWinner>();
  for (const winner of winners) {
    const key = canonicalReferenceKey(winner.reference);
    if (key.length === 0 || byReference.has(key)) continue;
    byReference.set(key, winner);
  }
  return byReference;
}

/** Resolves one submission's verdict against the indexed public winners. */
function resolveOutcome(
  submission: PortalSubmissionRecord,
  winnersByReference: Map<string, OutcomeWinner>,
  ourNormalized: string,
): SubmissionOutcome {
  // A withdrawn soumission has no winner question to ask — we pulled out.
  if (submission.withdrawnAt) return { submission, outcome: 'retire' };

  const winner = winnersByReference.get(
    canonicalReferenceKey(submission.reference),
  );
  // No published attribution yet → the market is still being adjudicated.
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
  const winnersByReference = indexWinnersByReference(winners);
  return submissions.map((submission) =>
    resolveOutcome(submission, winnersByReference, ourNormalized),
  );
}
