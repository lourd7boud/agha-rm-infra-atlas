import { describe, expect, it } from 'vitest';
import {
  isPlausibleRebatePct,
  rebateForObservation,
  summarizeRebates,
  type RebateObservation,
} from './rebate.domain';

/** A winner whose montant sits at `rebatePct` below a round 1,000,000 estimation. */
function winner(
  reference: string,
  buyerName: string,
  amountMad: number,
  segment?: string,
): RebateObservation {
  return {
    reference,
    buyerName,
    amountMad,
    estimationMad: 1_000_000,
    isWinner: true,
    ...(segment ? { segment } : {}),
  };
}

describe('isPlausibleRebatePct', () => {
  it('accepts a realistic public-works winning rebate', () => {
    expect(isPlausibleRebatePct(18)).toBe(true);
    expect(isPlausibleRebatePct(0)).toBe(true);
  });

  it('rejects the impossible rebate of a misread montant (poisoned row)', () => {
    // estimation 1.18M, montant misread as ~1.17 billion → ~ -99,000 %.
    const poisoned = ((1_177_913.89 - 1_170_000_000) / 1_177_913.89) * 100;
    expect(isPlausibleRebatePct(poisoned)).toBe(false);
  });
});

describe('rebateForObservation', () => {
  it('computes the winner rebate against the estimation', () => {
    expect(rebateForObservation(winner('A', 'ANEF', 800_000))).toBe(20);
  });

  it('is null when the record is not the winner', () => {
    const loser: RebateObservation = {
      reference: 'L',
      buyerName: 'ANEF',
      amountMad: 800_000,
      estimationMad: 1_000_000,
      isWinner: false,
    };
    expect(rebateForObservation(loser)).toBeNull();
  });

  it('is null without an estimation to rebate against', () => {
    expect(
      rebateForObservation({
        reference: 'X',
        buyerName: 'ANEF',
        amountMad: 800_000,
        isWinner: true,
      }),
    ).toBeNull();
  });

  it('is null for an implausible (outlier) rebate', () => {
    expect(
      rebateForObservation({
        reference: 'P',
        buyerName: 'ANEF',
        amountMad: 1_170_000_000,
        estimationMad: 1_177_913.89,
        isWinner: true,
      }),
    ).toBeNull();
  });
});

describe('summarizeRebates', () => {
  it('builds the overall distribution from plausible winner rebates', () => {
    // Arrange: rebates 20, 15, 10, 25 (%) on a 1,000,000 estimation.
    const obs = [
      winner('A', 'ANEF', 800_000),
      winner('B', 'ANEF', 850_000),
      winner('C', 'ORMVA', 900_000),
      winner('D', 'ORMVA', 750_000),
    ];

    // Act
    const { overall, sampled, rejected } = summarizeRebates(obs);

    // Assert
    expect(sampled).toBe(4);
    expect(rejected).toBe(0);
    expect(overall).toEqual({
      count: 4,
      medianPct: 17.5,
      p25Pct: 13.75,
      p75Pct: 21.25,
      meanPct: 17.5,
    });
  });

  it('counts outliers as rejected and keeps them out of the sample', () => {
    const obs = [
      winner('A', 'ANEF', 800_000),
      {
        reference: 'P',
        buyerName: 'ANEF',
        amountMad: 1_170_000_000,
        estimationMad: 1_177_913.89,
        isWinner: true,
      },
    ];

    const { overall, sampled, rejected } = summarizeRebates(obs);

    expect(sampled).toBe(1);
    expect(rejected).toBe(1);
    expect(overall?.count).toBe(1);
    expect(overall?.medianPct).toBe(20);
  });

  it('groups distributions by buyer, ranked by sample size', () => {
    const obs = [
      winner('A', 'ANEF', 800_000),
      winner('B', 'ANEF', 850_000),
      winner('C', 'ORMVA', 900_000),
    ];

    const { byBuyer } = summarizeRebates(obs);

    expect(byBuyer.map((b) => b.buyerName)).toEqual(['ANEF', 'ORMVA']);
    expect(byBuyer[0]).toMatchObject({ buyerName: 'ANEF', count: 2, medianPct: 17.5 });
    expect(byBuyer[1]).toMatchObject({ buyerName: 'ORMVA', count: 1, medianPct: 10 });
  });

  it('groups by segment and ignores observations without one', () => {
    const obs = [
      winner('A', 'ANEF', 800_000, 'forets'),
      winner('B', 'ORMVA', 850_000, 'forets'),
      winner('C', 'ONEE', 900_000), // no segment
    ];

    const { bySegment } = summarizeRebates(obs);

    expect(bySegment).toHaveLength(1);
    expect(bySegment[0]).toMatchObject({ segment: 'forets', count: 2 });
  });

  it('returns a null overall distribution when nothing is sampleable', () => {
    const { overall, byBuyer, bySegment, sampled } = summarizeRebates([]);
    expect(overall).toBeNull();
    expect(byBuyer).toEqual([]);
    expect(bySegment).toEqual([]);
    expect(sampled).toBe(0);
  });
});
