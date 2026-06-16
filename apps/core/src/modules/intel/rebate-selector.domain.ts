import {
  canonicalBuyerKey,
  type RebateBenchmarks,
  type RebateDistribution,
} from './rebate.domain';

/**
 * Rebate benchmark selector — picks the single most-specific TRUSTWORTHY
 * recovered-rebate distribution for a tender's (buyer, segment) from the
 * already-aggregated RebateBenchmarks. Pure, zero query cost: it only reads the
 * rows summarizeRebates already produced.
 *
 * Precedence: buyer → segment → overall, each gated by a minimum sample size so
 * a one-off observation can never move the company's price. Returns null (never
 * a synthesized zero) when nothing clears the gate — the fresh-system default.
 */

/**
 * Minimum recovered-winner observations before a buyer/segment median is
 * trusted enough to surface and drive pricing. Below this the pricing engine
 * stays on its heuristic ladder and makes no calibration claim.
 */
export const MIN_REBATE_SAMPLE = 5;

export type RebateBenchmarkSource = 'buyer' | 'segment' | 'overall';

export interface SelectedRebate extends RebateDistribution {
  source: RebateBenchmarkSource;
  /** Matched key for the brief copy: raw buyerName, segment slug, or 'overall'. */
  key: string;
}

export interface RebateSelectOptions {
  buyerName: string;
  segment: string;
  /** Minimum sample size to trust a tier. Defaults to MIN_REBATE_SAMPLE. */
  minCount?: number;
}

/** Copies just the distribution leaf fields (drops buyerName/segment labels). */
function pickDistribution(d: RebateDistribution): RebateDistribution {
  return {
    count: d.count,
    medianPct: d.medianPct,
    p25Pct: d.p25Pct,
    p75Pct: d.p75Pct,
    meanPct: d.meanPct,
  };
}

export function selectRebateBenchmark(
  benchmarks: RebateBenchmarks,
  opts: RebateSelectOptions,
): SelectedRebate | null {
  const min = opts.minCount ?? MIN_REBATE_SAMPLE;

  // Buyer names arrive from two independent ingestion paths (tender intake vs
  // the result-crawler vision); match on the same canonical key the aggregation
  // groups on, so case/accent/punctuation drift cannot miss the buyer tier.
  const buyerKey = canonicalBuyerKey(opts.buyerName);
  const buyer = benchmarks.byBuyer.find(
    (b) => b.count >= min && canonicalBuyerKey(b.buyerName) === buyerKey,
  );
  if (buyer) {
    return { ...pickDistribution(buyer), source: 'buyer', key: buyer.buyerName };
  }

  const segment = benchmarks.bySegment.find(
    (s) => s.count >= min && s.segment === opts.segment,
  );
  if (segment) {
    return { ...pickDistribution(segment), source: 'segment', key: segment.segment };
  }

  const overall = benchmarks.overall;
  if (overall && overall.count >= min) {
    return { ...pickDistribution(overall), source: 'overall', key: 'overall' };
  }

  return null;
}
