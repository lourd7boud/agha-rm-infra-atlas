import { describe, expect, test } from 'vitest';
import { buildCompetitorProfile } from './intel.profile';
import type { CompetitorBidRecord, CompetitorRecord } from './intel.repository';

const COMPETITOR: CompetitorRecord = {
  id: 'c-1',
  canonicalName: 'SOTRAVHYD SARL',
  normalizedName: 'sotravhyd',
};

function bid(partial: Partial<CompetitorBidRecord>): CompetitorBidRecord {
  return {
    id: partial.id ?? 'b-x',
    reference: partial.reference ?? 'AO 1/2026/X',
    buyerName: partial.buyerName ?? 'ORMVAH',
    bidderName: partial.bidderName ?? 'SOTRAVHYD SARL',
    competitorId: 'c-1',
    amountMad: partial.amountMad,
    isWinner: partial.isWinner ?? true,
    resultDate: partial.resultDate,
    sourceUrl: undefined,
    createdAt: partial.createdAt ?? new Date('2026-06-01T00:00:00Z'),
  };
}

describe('buildCompetitorProfile', () => {
  test('aggregates wins, amounts and buyer breakdown', () => {
    const profile = buildCompetitorProfile(COMPETITOR, [
      bid({
        id: 'b-1',
        reference: 'AO 1',
        amountMad: 1_000_000,
        resultDate: new Date('2026-01-10T00:00:00Z'),
      }),
      bid({
        id: 'b-2',
        reference: 'AO 2',
        amountMad: 3_000_000,
        resultDate: new Date('2026-03-15T00:00:00Z'),
      }),
      bid({
        id: 'b-3',
        reference: 'AO 3',
        buyerName: 'DRETLH',
        amountMad: 2_000_000,
        resultDate: new Date('2026-02-20T00:00:00Z'),
      }),
    ]);

    expect(profile.wins).toBe(3);
    expect(profile.totalWonMad).toBe(6_000_000);
    expect(profile.avgWinMad).toBe(2_000_000);
    expect(profile.minWinMad).toBe(1_000_000);
    expect(profile.maxWinMad).toBe(3_000_000);
    expect(profile.buyers[0]).toEqual({
      buyerName: 'ORMVAH',
      wins: 2,
      totalMad: 4_000_000,
    });
    expect(profile.firstSeen).toBe('2026-01-10');
    expect(profile.lastSeen).toBe('2026-03-15');
  });

  test('non-winning observations are kept out of win stats', () => {
    const profile = buildCompetitorProfile(COMPETITOR, [
      bid({ id: 'b-1', amountMad: 1_000_000 }),
      bid({ id: 'b-2', reference: 'AO 9', amountMad: 9_000_000, isWinner: false }),
    ]);

    expect(profile.wins).toBe(1);
    expect(profile.totalWonMad).toBe(1_000_000);
    expect(profile.observations).toBe(2);
  });

  test('recent results are sorted by date desc and capped at 5', () => {
    const bids = Array.from({ length: 7 }, (_, i) =>
      bid({
        id: `b-${i}`,
        reference: `AO ${i}`,
        resultDate: new Date(
          `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        ),
      }),
    );
    const profile = buildCompetitorProfile(COMPETITOR, bids);

    expect(profile.recentResults).toHaveLength(5);
    expect(profile.recentResults[0]?.resultDate?.toISOString()).toContain(
      '2026-01-07',
    );
    expect(profile.recentResults[4]?.resultDate?.toISOString()).toContain(
      '2026-01-03',
    );
  });

  test('handles a competitor with no recorded amounts', () => {
    const profile = buildCompetitorProfile(COMPETITOR, [bid({ amountMad: undefined })]);

    expect(profile.wins).toBe(1);
    expect(profile.totalWonMad).toBe(0);
    expect(profile.avgWinMad).toBeNull();
    expect(profile.minWinMad).toBeNull();
    expect(profile.maxWinMad).toBeNull();
  });
});
