import { recoveredRebatePct } from '../tender/outcome.domain';

/**
 * Rebate calibration (intelligence M2) — turns the Result Miner's winner
 * observations into the company's most valuable number: how deep the *winning*
 * rebate runs against the administrative estimation, per buyer and per segment.
 *
 * Pure aggregation over `recoveredRebatePct` (the founding per-record metric in
 * tender/outcome.domain). A plausibility band guards the sample so a single
 * mis-read montant (vision can fumble a decimal comma → a billion-dirham
 * outlier) cannot poison a buyer's median. Published results only.
 */

/**
 * Plausible winning-rebate band (%). Moroccan public-works rabais cluster well
 * inside this; a value outside it is a data error (mis-read amount), not a real
 * rebate, so it is dropped from the sample and counted as rejected.
 */
export const MIN_PLAUSIBLE_REBATE_PCT = -25;
export const MAX_PLAUSIBLE_REBATE_PCT = 70;

export interface RebateObservation {
  reference: string;
  buyerName: string;
  segment?: string;
  estimationMad?: number;
  amountMad?: number;
  isWinner: boolean;
}

export interface RebateDistribution {
  count: number;
  medianPct: number;
  p25Pct: number;
  p75Pct: number;
  meanPct: number;
}

export interface BuyerRebate extends RebateDistribution {
  buyerName: string;
}

export interface SegmentRebate extends RebateDistribution {
  segment: string;
}

export interface RebateBenchmarks {
  /** Distribution across every plausible winner rebate, or null when none. */
  overall: RebateDistribution | null;
  byBuyer: BuyerRebate[];
  bySegment: SegmentRebate[];
  /** Observations that yielded a plausible rebate (the sample size). */
  sampled: number;
  /** Observations with estimation+montant whose rebate fell outside the band. */
  rejected: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isPlausibleRebatePct(pct: number): boolean {
  return (
    Number.isFinite(pct) &&
    pct >= MIN_PLAUSIBLE_REBATE_PCT &&
    pct <= MAX_PLAUSIBLE_REBATE_PCT
  );
}

/**
 * The recovered winning rebate for one observation, or null when it cannot be
 * trusted: not the winner, no estimation/montant, or an implausible outlier.
 */
export function rebateForObservation(obs: RebateObservation): number | null {
  if (!obs.isWinner) return null;
  const pct = recoveredRebatePct(obs.estimationMad, obs.amountMad);
  if (pct === null || !isPlausibleRebatePct(pct)) return null;
  return pct;
}

/** Linear-interpolated percentile (p in [0,1]) over an ascending-sorted array. */
function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0] as number;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sortedAsc[lo] as number;
  if (lo === hi) return loVal;
  const hiVal = sortedAsc[hi] as number;
  return loVal + (hiVal - loVal) * (idx - lo);
}

function distribution(pcts: readonly number[]): RebateDistribution {
  const sorted = [...pcts].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, p) => sum + p, 0) / sorted.length;
  return {
    count: sorted.length,
    medianPct: round2(percentile(sorted, 0.5)),
    p25Pct: round2(percentile(sorted, 0.25)),
    p75Pct: round2(percentile(sorted, 0.75)),
    meanPct: round2(mean),
  };
}

interface Sample {
  buyerName: string;
  segment?: string;
  pct: number;
}

function groupBy<K extends string>(
  samples: readonly Sample[],
  keyOf: (s: Sample) => K | undefined,
): Map<K, number[]> {
  const groups = new Map<K, number[]>();
  for (const s of samples) {
    const key = keyOf(s);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s.pct);
    else groups.set(key, [s.pct]);
  }
  return groups;
}

/** Aggregate winner observations into overall + per-buyer + per-segment rebate stats. */
export function summarizeRebates(
  observations: readonly RebateObservation[],
): RebateBenchmarks {
  const samples: Sample[] = [];
  let rejected = 0;

  for (const obs of observations) {
    if (!obs.isWinner) continue;
    const raw = recoveredRebatePct(obs.estimationMad, obs.amountMad);
    if (raw === null) continue; // no estimation/montant — not a data error
    if (!isPlausibleRebatePct(raw)) {
      rejected += 1; // had the inputs but the rebate is impossible → outlier
      continue;
    }
    samples.push({ buyerName: obs.buyerName, segment: obs.segment, pct: raw });
  }

  const byBuyer: BuyerRebate[] = [...groupBy(samples, (s) => s.buyerName)]
    .map(([buyerName, pcts]) => ({ buyerName, ...distribution(pcts) }))
    .sort((a, b) => b.count - a.count || b.medianPct - a.medianPct);

  const bySegment: SegmentRebate[] = [...groupBy(samples, (s) => s.segment)]
    .map(([segment, pcts]) => ({ segment, ...distribution(pcts) }))
    .sort((a, b) => b.count - a.count || b.medianPct - a.medianPct);

  return {
    overall: samples.length > 0 ? distribution(samples.map((s) => s.pct)) : null,
    byBuyer,
    bySegment,
    sampled: samples.length,
    rejected,
  };
}
