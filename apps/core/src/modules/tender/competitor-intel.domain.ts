import type { CompetitorBidRecord } from '../intel/intel.repository';
import { canonicalReferenceKey } from '../intel/intel.repository';
import { normalizeFr } from './qualifier.domain';

/**
 * Competitor intelligence for ONE tender — the datao-beating surface.
 *
 * datao only shows post-hoc raw results. ATLAS answers the question a bidder
 * actually has BEFORE deciding to bid: "who will I face here, and at what
 * price level does this buyer award?" — derived from the harvested PV/result
 * history (intel.competitor_bid).
 *
 * Two states:
 *   - CLOSED (result harvested for THIS reference): the REAL participants +
 *     amounts + winner, straight from the PV notice. Same-day, ahead of datao.
 *   - OPEN (no result yet): PREDICTIVE intel from this buyer's history — the
 *     firms that most often bid this buyer, their win counts, and the typical
 *     winning-rebate level. Honestly labelled "historique", never faked as live.
 */

export interface TenderParticipant {
  name: string;
  amountMad: number | null;
  isWinner: boolean;
}

export interface LikelyCompetitor {
  name: string;
  /** How many past tenders of THIS buyer this firm appeared on. */
  timesSeen: number;
  /** How many of those it won. */
  wins: number;
  /** Average bid amount across its known bids for this buyer (MAD), or null. */
  avgAmountMad: number | null;
}

export interface TenderCompetitorIntel {
  /** 'closed' when we have the harvested result for this exact reference. */
  mode: 'closed' | 'open';
  reference: string;
  buyerName: string;
  /** CLOSED: the real participants on THIS tender (winner + écartés). */
  participants: TenderParticipant[];
  /** CLOSED: the winning bidder, if any. */
  winner: TenderParticipant | null;
  /** OPEN: firms that historically bid this buyer, ranked by frequency. */
  likelyCompetitors: LikelyCompetitor[];
  /** OPEN: how many distinct past tenders of this buyer we hold results for. */
  buyerHistoryCount: number;
  /** Median winning rebate vs administrative estimation for this buyer (%), null when unknown. */
  buyerMedianRebatePct: number | null;
}

/** Average of the defined amounts, or null when none are known. */
function avgAmount(amounts: readonly (number | null | undefined)[]): number | null {
  const defined = amounts.filter((a): a is number => typeof a === 'number');
  if (defined.length === 0) return null;
  return Math.round(defined.reduce((s, a) => s + a, 0) / defined.length);
}

/** Median of a numeric list, or null when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

const MAX_LIKELY_COMPETITORS = 12;

/**
 * Pure builder. `allBids` is the full competitor_bid scan (already cached by
 * the caller). Matching is by canonical reference key (exact tender) and by
 * normalized buyer name (buyer history) — the same folding the rest of the
 * intel module uses, so the two harvest paths agree.
 */
export function buildTenderCompetitorIntel(
  tender: { reference: string; buyerName: string; deadlineAt: Date },
  allBids: readonly CompetitorBidRecord[],
  now: Date,
): TenderCompetitorIntel {
  const refKey = canonicalReferenceKey(tender.reference);
  const buyerCanon = canonicalReferenceKey(tender.buyerName);
  // A result can only exist AFTER the deadline, and generic references (NN/2026)
  // are reused across hundreds of acheteurs — so a "closed" match requires the
  // deadline to have passed AND the bid to share this tender's reference AND
  // buyer. This mirrors the BidResolver lifecycle so the result panel and this
  // competitor-intel view never disagree (both were reference-only before).
  const deadlinePassed = tender.deadlineAt.getTime() < now.getTime();
  const thisTenderBids = deadlinePassed
    ? allBids.filter(
        (b) =>
          canonicalReferenceKey(b.reference) === refKey &&
          canonicalReferenceKey(b.buyerName) === buyerCanon,
      )
    : [];

  // CLOSED when we actually harvested this tender's result.
  if (thisTenderBids.length > 0) {
    const participants: TenderParticipant[] = thisTenderBids
      .map((b) => ({
        name: b.bidderName,
        amountMad: b.amountMad ?? null,
        isWinner: b.isWinner,
      }))
      .sort((a, b) => {
        // Winner first, then ascending amount (lowest bid is the reference).
        if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
        return (a.amountMad ?? Infinity) - (b.amountMad ?? Infinity);
      });
    const winner = participants.find((p) => p.isWinner) ?? null;
    return {
      mode: 'closed',
      reference: tender.reference,
      buyerName: tender.buyerName,
      participants,
      winner,
      likelyCompetitors: [],
      buyerHistoryCount: 0,
      buyerMedianRebatePct: null,
    };
  }

  // OPEN → predictive intel from this buyer's harvested history.
  const buyerKey = normalizeFr(tender.buyerName);
  const buyerBids = allBids.filter(
    (b) => normalizeFr(b.buyerName) === buyerKey && b.buyerName.length > 0,
  );
  const buyerReferences = new Set(
    buyerBids.map((b) => canonicalReferenceKey(b.reference)),
  );

  // Group buyer bids by bidder to rank likely competitors.
  const byBidder = new Map<string, CompetitorBidRecord[]>();
  for (const bid of buyerBids) {
    const key = bid.bidderName;
    const list = byBidder.get(key);
    if (list) list.push(bid);
    else byBidder.set(key, [bid]);
  }
  const likelyCompetitors: LikelyCompetitor[] = [...byBidder.entries()]
    .map(([name, bids]) => ({
      name,
      timesSeen: new Set(bids.map((b) => canonicalReferenceKey(b.reference))).size,
      wins: bids.filter((b) => b.isWinner).length,
      avgAmountMad: avgAmount(bids.map((b) => b.amountMad)),
    }))
    .sort((a, b) => b.timesSeen - a.timesSeen || b.wins - a.wins)
    .slice(0, MAX_LIKELY_COMPETITORS);

  // Median winning rebate vs estimation for this buyer.
  const rebates: number[] = buyerBids
    .filter(
      (b) =>
        b.isWinner &&
        typeof b.amountMad === 'number' &&
        typeof b.estimationMad === 'number' &&
        b.estimationMad > 0,
    )
    .map((b) => ((b.estimationMad! - b.amountMad!) / b.estimationMad!) * 100);

  return {
    mode: 'open',
    reference: tender.reference,
    buyerName: tender.buyerName,
    participants: [],
    winner: null,
    likelyCompetitors,
    buyerHistoryCount: buyerReferences.size,
    buyerMedianRebatePct: median(rebates),
  };
}
