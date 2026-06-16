import { describe, expect, it } from 'vitest';
import type { RebateBenchmarks } from './rebate.domain';
import {
  MIN_REBATE_SAMPLE,
  selectRebateBenchmark,
} from './rebate-selector.domain';

function dist(count: number, median: number) {
  return { count, medianPct: median, p25Pct: median - 4, p75Pct: median + 4, meanPct: median };
}

function benchmarks(partial: Partial<RebateBenchmarks>): RebateBenchmarks {
  return {
    overall: null,
    byBuyer: [],
    bySegment: [],
    sampled: 0,
    rejected: 0,
    ...partial,
  };
}

describe('selectRebateBenchmark', () => {
  it('returns null on the empty/sparse benchmarks of a fresh system', () => {
    const result = selectRebateBenchmark(benchmarks({}), {
      buyerName: 'ONEE',
      segment: 'eau_potable',
    });
    expect(result).toBeNull();
  });

  it('prefers the buyer row when it clears the sample gate', () => {
    const result = selectRebateBenchmark(
      benchmarks({
        byBuyer: [{ buyerName: 'ONEE', ...dist(MIN_REBATE_SAMPLE, 14) }],
        bySegment: [{ segment: 'eau_potable', ...dist(20, 9) }],
        overall: dist(40, 11),
      }),
      { buyerName: 'ONEE', segment: 'eau_potable' },
    );
    expect(result).toMatchObject({ source: 'buyer', key: 'ONEE', medianPct: 14 });
  });

  it('matches the buyer despite case and accent differences', () => {
    const result = selectRebateBenchmark(
      benchmarks({
        byBuyer: [{ buyerName: 'Commune de Témara', ...dist(8, 12) }],
      }),
      { buyerName: 'COMMUNE DE TEMARA', segment: 'routes' },
    );
    expect(result).toMatchObject({ source: 'buyer', medianPct: 12 });
  });

  it('falls back to the segment row when the buyer is absent or under-sampled', () => {
    const underSampledBuyer = selectRebateBenchmark(
      benchmarks({
        byBuyer: [{ buyerName: 'ONEE', ...dist(MIN_REBATE_SAMPLE - 1, 30) }],
        bySegment: [{ segment: 'eau_potable', ...dist(12, 15) }],
      }),
      { buyerName: 'ONEE', segment: 'eau_potable' },
    );
    expect(underSampledBuyer).toMatchObject({
      source: 'segment',
      key: 'eau_potable',
      medianPct: 15,
    });
  });

  it('falls back to overall when neither buyer nor segment qualifies', () => {
    const result = selectRebateBenchmark(
      benchmarks({ overall: dist(30, 10) }),
      { buyerName: 'Unknown', segment: 'autre' },
    );
    expect(result).toMatchObject({ source: 'overall', key: 'overall', medianPct: 10 });
  });

  it('returns null when even overall is below the gate', () => {
    const result = selectRebateBenchmark(
      benchmarks({ overall: dist(MIN_REBATE_SAMPLE - 1, 10) }),
      { buyerName: 'Unknown', segment: 'autre' },
    );
    expect(result).toBeNull();
  });

  it('carries only the distribution fields plus source/key (no buyerName/segment leak)', () => {
    const result = selectRebateBenchmark(
      benchmarks({ byBuyer: [{ buyerName: 'ONEE', ...dist(6, 14) }] }),
      { buyerName: 'ONEE', segment: 'eau_potable' },
    );
    expect(result).toEqual({
      source: 'buyer',
      key: 'ONEE',
      count: 6,
      medianPct: 14,
      p25Pct: 10,
      p75Pct: 18,
      meanPct: 14,
    });
  });

  it('matches the buyer across whitespace and punctuation drift', () => {
    const result = selectRebateBenchmark(
      benchmarks({ byBuyer: [{ buyerName: 'Commune de Rabat', ...dist(6, 12) }] }),
      { buyerName: 'Commune de Rabat. ', segment: 'routes' },
    );
    expect(result).toMatchObject({ source: 'buyer', medianPct: 12 });
  });

  it('never matches the buyer tier on the unknown-buyer placeholder', () => {
    const result = selectRebateBenchmark(
      benchmarks({
        byBuyer: [{ buyerName: 'Acheteur non précisé', ...dist(10, 14) }],
        bySegment: [{ segment: 'routes', ...dist(8, 9) }],
      }),
      { buyerName: 'Acheteur non précisé', segment: 'routes' },
    );
    expect(result).toMatchObject({ source: 'segment', medianPct: 9 });
  });

  it('honours an explicit lower minCount', () => {
    const result = selectRebateBenchmark(
      benchmarks({ byBuyer: [{ buyerName: 'ONEE', ...dist(2, 14) }] }),
      { buyerName: 'ONEE', segment: 'eau_potable', minCount: 2 },
    );
    expect(result).toMatchObject({ source: 'buyer', count: 2 });
  });
});
