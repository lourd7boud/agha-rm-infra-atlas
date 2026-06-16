import { Inject, Injectable } from '@nestjs/common';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  PORTAL_REPOSITORY,
  type PortalRepository,
} from './portal.repository';
import {
  canonicalReferenceKey,
  computeSubmissionOutcomes,
  type OutcomeWinner,
  type SubmissionOutcome,
} from './portal-outcome.domain';

/**
 * READ-ONLY reconciliation service. Loads OUR own soumissions from the portal
 * repository and the public attribution winners the Result Miner already stored
 * in intel.competitor_bid, then delegates the verdict to the pure
 * computeSubmissionOutcomes domain fn. It reads only — it never writes
 * tender.submission_outcome (that destructive derivation is a later phase).
 */

/** How many of our most recent soumissions to reconcile per call. */
const DEFAULT_SUBMISSION_LIMIT = 200;

@Injectable()
export class PortalOutcomeService {
  constructor(
    @Inject(PORTAL_REPOSITORY) private readonly portal: PortalRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
  ) {}

  /**
   * Returns, per submission, its outcome verdict ('gagne' | 'perdu' |
   * 'en_attente' | 'retire') plus the winner name/montant when a published
   * attribution exists. Pure decision lives in the domain fn; this method loads
   * our soumissions, then asks intel for ONLY the winners whose canonical
   * reference matches one of those soumissions — a targeted join that cannot
   * silently drop a published winner the way a fixed result-scan limit could.
   */
  async ourSubmissionsWithOutcome(): Promise<SubmissionOutcome[]> {
    const submissions = await this.portal.listSubmissions(
      DEFAULT_SUBMISSION_LIMIT,
    );
    // De-duplicate the canonical keys of our soumissions, then fetch only the
    // winner rows for those exact markets (no whole-table scan, no ceiling).
    const canonicalKeys = [
      ...new Set(submissions.map((s) => canonicalReferenceKey(s.reference))),
    ];
    const winnerBids = await this.intel.findWinnersByReferences(canonicalKeys);
    const winners: OutcomeWinner[] = winnerBids.map((bid) => ({
      reference: bid.reference,
      bidderName: bid.bidderName,
      ...(bid.amountMad !== undefined ? { amountMad: bid.amountMad } : {}),
    }));
    return computeSubmissionOutcomes(submissions, winners);
  }
}
