import type { TenderRecord } from '../tender/tender.repository';
import {
  normalizeCompanyName,
  type CompetitorBidRecord,
} from '../intel/intel.repository';
import {
  canonicalBuyerKey,
  UNKNOWN_BUYER_KEY,
  type BuyerRebate,
  type RebateBenchmarks,
  type RebateDistribution,
  type SegmentRebate,
} from '../intel/rebate.domain';
import {
  buildBuyerProfiles,
  type CountEntry,
} from '../tender/buyer-observatory.domain';
import { inferCategory, inferSegment } from '../tender/inventory.domain';
import { readDossierExtraction } from '../tender/dossier-extraction';

/**
 * Expert knowledge base — what the AGHA-RM-INFRA agent has "learned" from the
 * whole catalogue: the market map (who buys what), the competitive field (how
 * many bidders actually show up, who wins), and the winning-rebate benchmarks.
 * Pure aggregation over data other modules already persist; recomputed on read
 * so every new crawl/harvest immediately deepens the agent's expertise.
 */

/** Caps applied to the published knowledge lists (full data stays queryable). */
const TOP_BUYERS = 15;
const TOP_COMPETITORS = 15;
const TOP_SEGMENTS = 8;
const TOP_REBATE_ROWS = 10;

const round1 = (value: number): number => Math.round(value * 10) / 10;

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
 * to the normalized company name for legacy rows.
 */
export function summarizeParticipation(
  bids: readonly CompetitorBidRecord[],
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

export interface KnowledgeBuyerProfile {
  buyerName: string;
  region: string;
  tenderCount: number;
  activeCount: number;
  avgEstimationMad: number | null;
  topSegments: string[];
}

export interface ExpertKnowledge {
  generatedAt: string;
  marche: {
    tendersTotal: number;
    tendersActive: number;
    buyersTotal: number;
    withBudget: number;
    withCaution: number;
    withBpu: number;
    categories: CountEntry[];
    topSegments: CountEntry[];
  };
  concurrence: ParticipationSummary;
  rabais: {
    sampled: number;
    rejected: number;
    overall: RebateDistribution | null;
    topBuyers: BuyerRebate[];
    topSegments: SegmentRebate[];
  };
  topAcheteurs: KnowledgeBuyerProfile[];
}

function tally<T>(items: readonly T[], key: (item: T) => string): CountEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface ExpertKnowledgeInput {
  tenders: readonly TenderRecord[];
  bids: readonly CompetitorBidRecord[];
  benchmarks: RebateBenchmarks | null;
  now: Date;
}

/** The agent's whole market memory, condensed for grounding and display. */
export function buildExpertKnowledge(input: ExpertKnowledgeInput): ExpertKnowledge {
  const { tenders, bids, benchmarks, now } = input;

  const active = tenders.filter((t) => t.deadlineAt.getTime() >= now.getTime());
  const buyers = new Set(tenders.map((t) => t.buyerName));
  const withBpu = tenders.filter((t) => {
    const extraction = readDossierExtraction(t.raw);
    return (extraction?.bpu?.length ?? 0) > 0;
  }).length;

  const participation = summarizeParticipation(bids);

  return {
    generatedAt: now.toISOString(),
    marche: {
      tendersTotal: tenders.length,
      tendersActive: active.length,
      buyersTotal: buyers.size,
      withBudget: tenders.filter((t) => t.estimationMad != null).length,
      withCaution: tenders.filter((t) => t.cautionProvisoireMad != null).length,
      withBpu,
      categories: tally(tenders, (t) => inferCategory(t.objet)),
      topSegments: tally(tenders, (t) => inferSegment(t.objet, t.buyerName)).slice(
        0,
        TOP_SEGMENTS,
      ),
    },
    concurrence: {
      ...participation,
      byBuyer: participation.byBuyer.slice(0, TOP_BUYERS),
      topCompetitors: participation.topCompetitors.slice(0, TOP_COMPETITORS),
    },
    rabais: {
      sampled: benchmarks?.sampled ?? 0,
      rejected: benchmarks?.rejected ?? 0,
      overall: benchmarks?.overall ?? null,
      topBuyers: benchmarks?.byBuyer.slice(0, TOP_REBATE_ROWS) ?? [],
      topSegments: benchmarks?.bySegment.slice(0, TOP_REBATE_ROWS) ?? [],
    },
    topAcheteurs: buildBuyerProfiles([...tenders])
      .slice(0, TOP_BUYERS)
      .map((profile) => ({
        buyerName: profile.buyerName,
        region: profile.region,
        tenderCount: profile.tenderCount,
        activeCount: profile.activeCount,
        avgEstimationMad: profile.avgEstimationMad,
        topSegments: profile.topSegments.slice(0, 3).map((s) => s.key),
      })),
  };
}
