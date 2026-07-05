import { describe, expect, test } from 'vitest';
import type { CompetitorBidRecord } from '../intel/intel.repository';
import { buildTenderCompetitorIntel } from './competitor-intel.domain';

const NOW = new Date('2026-06-13T00:00:00Z');

function bid(overrides: Partial<CompetitorBidRecord>): CompetitorBidRecord {
  return {
    id: overrides.id ?? 'b1',
    reference: overrides.reference ?? '05/2026',
    buyerName: overrides.buyerName ?? 'Commune de Rabat',
    bidderName: overrides.bidderName ?? 'Concurrent A',
    competitorId: overrides.competitorId ?? 'c1',
    amountMad: overrides.amountMad,
    isWinner: overrides.isWinner ?? false,
    resultDate: overrides.resultDate ?? new Date('2026-05-10T00:00:00Z'),
    createdAt: overrides.createdAt ?? new Date('2026-05-10T00:00:00Z'),
    estimationMad: overrides.estimationMad,
    objet: overrides.objet,
    sourceUrl: overrides.sourceUrl,
  } as CompetitorBidRecord;
}

describe('buildTenderCompetitorIntel', () => {
  test('CLOSED only when the deadline has passed AND a same-buyer result exists', () => {
    const tender = {
      reference: '05/2026',
      buyerName: 'Commune de Rabat',
      deadlineAt: new Date('2026-05-01T09:00:00Z'), // past
    };
    const bids = [
      bid({ id: 'w', bidderName: 'PROMALAB', isWinner: true, amountMad: 24804 }),
      bid({ id: 'l', bidderName: 'Autre SARL', isWinner: false, amountMad: 30000 }),
    ];
    const intel = buildTenderCompetitorIntel(tender, bids, NOW);
    expect(intel.mode).toBe('closed');
    expect(intel.winner?.name).toBe('PROMALAB');
    expect(intel.participants).toHaveLength(2);
  });

  test('a FUTURE-deadline tender is NEVER closed, even with a same-ref+buyer bid', () => {
    const tender = {
      reference: '05/2026',
      buyerName: 'Commune de Rabat',
      deadlineAt: new Date('2026-08-01T09:00:00Z'), // future
    };
    const bids = [bid({ isWinner: true, bidderName: 'PROMALAB' })];
    const intel = buildTenderCompetitorIntel(tender, bids, NOW);
    expect(intel.mode).toBe('open');
    expect(intel.participants).toEqual([]);
    expect(intel.winner).toBeNull();
  });

  test('a bid with the same generic reference but a DIFFERENT buyer never marks the tender closed', () => {
    const tender = {
      reference: '05/2026',
      buyerName: 'Commune de Rabat',
      deadlineAt: new Date('2026-05-01T09:00:00Z'), // past
    };
    const bids = [
      bid({ buyerName: 'Commune de Casablanca', isWinner: true, bidderName: 'INTERFACE COMPUTER' }),
    ];
    const intel = buildTenderCompetitorIntel(tender, bids, NOW);
    // No result for THIS buyer → open (predictive), never the other buyer's winner.
    expect(intel.mode).toBe('open');
    expect(intel.winner).toBeNull();
    expect(intel.participants).toEqual([]);
  });

  test('OPEN path still surfaces this buyer historical competitors', () => {
    const tender = {
      reference: '99/2026', // no harvested result for this exact ref
      buyerName: 'Commune de Rabat',
      deadlineAt: new Date('2026-08-01T09:00:00Z'),
    };
    const bids = [
      bid({ id: 'h1', reference: '01/2025', bidderName: 'Habitué SARL', isWinner: true }),
      bid({ id: 'h2', reference: '02/2025', bidderName: 'Habitué SARL', isWinner: false }),
    ];
    const intel = buildTenderCompetitorIntel(tender, bids, NOW);
    expect(intel.mode).toBe('open');
    const habitue = intel.likelyCompetitors.find((c) => c.name === 'Habitué SARL');
    expect(habitue?.timesSeen).toBe(2);
    expect(habitue?.wins).toBe(1);
  });
});
