import { normalizeFr } from '../tender/qualifier.domain';
import { canonicalBuyerKey, UNKNOWN_BUYER_KEY } from './rebate.domain';

/**
 * Participation fold — the founding competition questions answered from the
 * published-bid harvest: how many bidders actually show up per consultation
 * (globally and per buyer) and who keeps winning. Moved out of the expert
 * module so the intel repository can share it: this file is a LEAF of the
 * intel module graph (it never imports intel.repository), which lets the
 * repository consume `summarizeParticipation` for its InMemory
 * `participationStats` without a require cycle. expert-knowledge.domain and
 * intel.repository re-export everything here, so existing import paths hold.
 */

/**
 * Cap every `participationStats` implementation applies to byBuyer and
 * topCompetitors. competitor_bid is heading for 150k-300k rows (129k-notice
 * historical backfill), so the repository contract returns bounded lists —
 * display surfaces slim them further (see expert-knowledge TOP_* caps).
 */
export const PARTICIPATION_TOP_LIMIT = 50;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Canonical normalization: accents/case/punctuation + legal-form suffixes. */
export function normalizeCompanyName(rawName: string): string {
  return normalizeFr(rawName)
    .replace(/[.,]/g, ' ')
    .replace(/\b(s\s?a\s?r\s?l|sarl|sa|s\s?a|ste|societe|au)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The bid fields the fold reads — CompetitorBidRecord narrows to this. */
export interface ParticipationBid {
  reference: string;
  buyerName: string;
  bidderName: string;
  /** Entity-resolved competitor id; '' on legacy rows (falls back to name). */
  competitorId: string;
  isWinner: boolean;
  amountMad?: number;
}

export interface ParticipationByBuyer {
  buyerName: string;
  /** Distinct consultations of this buyer with at least one published bid. */
  tendersObserved: number;
  avgBidders: number;
}

export interface TopCompetitor {
  name: string;
  participations: number;
  wins: number;
  totalWonMad: number;
}

export interface ParticipationSummary {
  /** Total published bid rows observed (every soumissionnaire, all PVs). */
  resultsObserved: number;
  /** Distinct consultations with at least one published bid. */
  tendersWithResults: number;
  /** Mean bidder count per consultation, or null before any result lands. */
  avgBiddersPerTender: number | null;
  byBuyer: ParticipationByBuyer[];
  topCompetitors: TopCompetitor[];
}

interface ReferenceGroup {
  bidders: Set<string>;
  buyerNames: Map<string, number>;
}

function mostFrequent(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Groups published bids per consultation to answer the founding competition
 * questions: how many bidders show up (globally and per buyer) and who keeps
 * winning. Bidder identity is the entity-resolved competitorId, falling back
 * to the normalized company name for legacy rows. The reference fold here has
 * a SQL twin in DrizzleIntelRepository.participationStats — keep them aligned.
 */
export function summarizeParticipation(
  bids: readonly ParticipationBid[],
): ParticipationSummary {
  const byReference = new Map<string, ReferenceGroup>();
  const competitors = new Map<
    string,
    { names: Map<string, number>; refs: Set<string>; wins: number; totalWonMad: number }
  >();

  for (const bid of bids) {
    const refKey = bid.reference.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
    const bidderKey = bid.competitorId || normalizeCompanyName(bid.bidderName);

    const group = byReference.get(refKey) ?? {
      bidders: new Set<string>(),
      buyerNames: new Map<string, number>(),
    };
    group.bidders.add(bidderKey);
    if (bid.buyerName) {
      group.buyerNames.set(
        bid.buyerName,
        (group.buyerNames.get(bid.buyerName) ?? 0) + 1,
      );
    }
    byReference.set(refKey, group);

    const competitor = competitors.get(bidderKey) ?? {
      names: new Map<string, number>(),
      refs: new Set<string>(),
      wins: 0,
      totalWonMad: 0,
    };
    competitor.names.set(
      bid.bidderName,
      (competitor.names.get(bid.bidderName) ?? 0) + 1,
    );
    // Distinct consultations, not raw rows — duplicate ingestion of the same
    // (reference, bidder) pair must not inflate the participation count.
    competitor.refs.add(refKey);
    if (bid.isWinner) {
      competitor.wins += 1;
      if (typeof bid.amountMad === 'number' && Number.isFinite(bid.amountMad)) {
        competitor.totalWonMad += bid.amountMad;
      }
    }
    competitors.set(bidderKey, competitor);
  }

  const perReferenceCounts = [...byReference.values()].map((g) => g.bidders.size);
  const avgBiddersPerTender =
    perReferenceCounts.length > 0
      ? round1(
          perReferenceCounts.reduce((sum, n) => sum + n, 0) /
            perReferenceCounts.length,
        )
      : null;

  // Per-buyer participation: group the reference groups on the canonical buyer
  // key (same fold the rebate aggregation uses) so name drift cannot split one
  // buyer into fragments.
  const buyers = new Map<
    string,
    { names: Map<string, number>; counts: number[] }
  >();
  for (const group of byReference.values()) {
    const displayName = mostFrequent(group.buyerNames);
    if (!displayName) continue;
    const key = canonicalBuyerKey(displayName);
    // The PV crawler's placeholder is not a buyer identity — mirroring the
    // rebate aggregation's contract, it never forms a byBuyer bucket (the
    // observations still count toward the global average above).
    if (key === UNKNOWN_BUYER_KEY) continue;
    const entry = buyers.get(key) ?? { names: new Map<string, number>(), counts: [] };
    entry.names.set(displayName, (entry.names.get(displayName) ?? 0) + 1);
    entry.counts.push(group.bidders.size);
    buyers.set(key, entry);
  }
  const byBuyer: ParticipationByBuyer[] = [...buyers.values()]
    .map((entry) => ({
      buyerName: mostFrequent(entry.names) ?? '',
      tendersObserved: entry.counts.length,
      avgBidders: round1(
        entry.counts.reduce((sum, n) => sum + n, 0) / entry.counts.length,
      ),
    }))
    .sort(
      (a, b) =>
        b.tendersObserved - a.tendersObserved ||
        a.buyerName.localeCompare(b.buyerName),
    );

  const topCompetitors: TopCompetitor[] = [...competitors.values()]
    .map((entry) => ({
      name: mostFrequent(entry.names) ?? '',
      participations: entry.refs.size,
      wins: entry.wins,
      totalWonMad: Math.round(entry.totalWonMad),
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.participations - a.participations ||
        a.name.localeCompare(b.name),
    );

  return {
    resultsObserved: bids.length,
    tendersWithResults: byReference.size,
    avgBiddersPerTender,
    byBuyer,
    topCompetitors,
  };
}
