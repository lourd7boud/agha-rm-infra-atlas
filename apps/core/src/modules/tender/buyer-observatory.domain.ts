import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { TenderRecord } from './tender.repository';
import { inferRegion, inferSegment } from './inventory.domain';

/**
 * Buyer Observatory — the demand side of the market map, built deterministically
 * from the tenders we already have. No LLM, no new column: who buys, how often,
 * in which region, on which ouvrage families. It is the seed of `buyer_profile`
 * and the axis (buyer × segment × region) every future rebate distribution is
 * sliced on. Money-side fields (avg estimation) fill in as enrichment lands.
 */

const TERMINAL_STATES: readonly PipelineState[] = [
  'won',
  'lost',
  'no_go',
  'rejected',
  'cancelled',
];

const UNLOCATED = 'Non localisé';
const TOP_SEGMENTS = 5;

export interface CountEntry {
  key: string;
  count: number;
}

export interface BuyerProfile {
  buyerName: string;
  region: string;
  tenderCount: number;
  activeCount: number;
  procedures: CountEntry[];
  topSegments: CountEntry[];
  withEstimationCount: number;
  avgEstimationMad: number | null;
  firstDeadline: Date | null;
  lastDeadline: Date | null;
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

function profileFor(buyerName: string, group: readonly TenderRecord[]): BuyerProfile {
  const region =
    tally(group, (r) => inferRegion(r.buyerName, r.objet) ?? UNLOCATED)[0]?.key ??
    UNLOCATED;

  const estimations = group
    .map((r) => r.estimationMad)
    .filter((v): v is number => v != null);
  const avgEstimationMad =
    estimations.length > 0
      ? Math.round(estimations.reduce((s, v) => s + v, 0) / estimations.length)
      : null;

  const deadlines = group.map((r) => r.deadlineAt.getTime());

  return {
    buyerName,
    region,
    tenderCount: group.length,
    activeCount: group.filter((r) => !TERMINAL_STATES.includes(r.pipelineState))
      .length,
    procedures: tally(group, (r) => r.procedure as TenderProcedure),
    topSegments: tally(group, (r) => inferSegment(r.objet, r.buyerName)).slice(
      0,
      TOP_SEGMENTS,
    ),
    withEstimationCount: estimations.length,
    avgEstimationMad,
    firstDeadline: deadlines.length ? new Date(Math.min(...deadlines)) : null,
    lastDeadline: deadlines.length ? new Date(Math.max(...deadlines)) : null,
  };
}

/** One aggregated profile per distinct buyer, busiest first. */
export function buildBuyerProfiles(
  tenders: readonly TenderRecord[],
): BuyerProfile[] {
  const groups = new Map<string, TenderRecord[]>();
  for (const tender of tenders) {
    const list = groups.get(tender.buyerName);
    if (list) list.push(tender);
    else groups.set(tender.buyerName, [tender]);
  }
  return [...groups.entries()]
    .map(([buyerName, group]) => profileFor(buyerName, group))
    .sort(
      (a, b) =>
        b.tenderCount - a.tenderCount || a.buyerName.localeCompare(b.buyerName),
    );
}

/** The profile of one buyer (exact name match), or null if unseen. */
export function buildBuyerProfile(
  tenders: readonly TenderRecord[],
  buyerName: string,
): BuyerProfile | null {
  const group = tenders.filter((t) => t.buyerName === buyerName);
  return group.length > 0 ? profileFor(buyerName, group) : null;
}
