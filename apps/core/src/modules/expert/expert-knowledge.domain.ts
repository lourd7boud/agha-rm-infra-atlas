import type { KnowledgeTenderRow } from '../tender/tender.repository';
import type { ParticipationSummary } from '../intel/participation.domain';
import type {
  BuyerRebate,
  RebateBenchmarks,
  RebateDistribution,
  SegmentRebate,
} from '../intel/rebate.domain';
import {
  buildBuyerProfiles,
  type CountEntry,
} from '../tender/buyer-observatory.domain';
import { inferCategory, inferSegment } from '../tender/inventory.domain';

/**
 * Expert knowledge base — what the AGHA-RM-INFRA agent has "learned" from the
 * whole catalogue: the market map (who buys what), the competitive field (how
 * many bidders actually show up, who wins), and the winning-rebate benchmarks.
 * Pure aggregation over data other modules already persist; recomputed on read
 * so every new crawl/harvest immediately deepens the agent's expertise.
 */

// The participation fold moved to intel/participation.domain so the intel
// repository can push it into SQL (competitor_bid at 150k-300k rows must not
// be full-loaded into JS). Re-exported to keep the expert-side import path —
// the pure fn still backs the InMemory repository and the domain specs.
export {
  summarizeParticipation,
  type ParticipationBid,
  type ParticipationByBuyer,
  type ParticipationSummary,
  type TopCompetitor,
} from '../intel/participation.domain';

/** Caps applied to the published knowledge lists (full data stays queryable). */
const TOP_BUYERS = 15;
const TOP_COMPETITORS = 15;
const TOP_SEGMENTS = 8;
const TOP_REBATE_ROWS = 10;

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
  tenders: readonly KnowledgeTenderRow[];
  /** Pre-aggregated participation — the repository pushes the fold into SQL. */
  participation: ParticipationSummary;
  benchmarks: RebateBenchmarks | null;
  now: Date;
}

/** The agent's whole market memory, condensed for grounding and display. */
export function buildExpertKnowledge(input: ExpertKnowledgeInput): ExpertKnowledge {
  const { tenders, participation, benchmarks, now } = input;

  const active = tenders.filter((t) => t.deadlineAt.getTime() >= now.getTime());
  const buyers = new Set(tenders.map((t) => t.buyerName));
  // hasBpu is computed in SQL by findAllForKnowledge — no raw jsonb here.
  const withBpu = tenders.filter((t) => t.hasBpu).length;

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
