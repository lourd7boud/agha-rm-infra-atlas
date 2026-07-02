import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import { DrizzleIntelRepository, InMemoryIntelRepository } from './intel.repository';
import { PARTICIPATION_TOP_LIMIT } from './participation.domain';

/**
 * Wiring test: an inserted winner's estimation + objet must survive into the
 * rebate benchmarks (segment inferred from the objet), and a mis-read montant
 * must be filtered out as an outlier rather than poisoning the median.
 */
describe('InMemoryIntelRepository.rebateBenchmarks', () => {
  it('mines the recovered rebate by buyer and segment, dropping outliers', async () => {
    // Arrange
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    await repo.insertResult(
      {
        reference: 'AO/1',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        estimationMad: 1_000_000, // → 20 % rebate
        objet: "travaux d'irrigation goutte a goutte",
        isWinner: true,
      },
      alpha.id,
    );
    await repo.insertResult(
      {
        reference: 'AO/2',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 1_170_000_000, // mis-read montant → impossible rebate
        estimationMad: 1_177_913.89,
        objet: "travaux d'assainissement",
        isWinner: true,
      },
      alpha.id,
    );

    // Act
    const benchmarks = await repo.rebateBenchmarks();

    // Assert
    expect(benchmarks.sampled).toBe(1);
    expect(benchmarks.rejected).toBe(1);
    expect(benchmarks.overall?.medianPct).toBe(20);
    expect(benchmarks.byBuyer).toEqual([
      expect.objectContaining({ buyerName: 'ORMVAH', count: 1, medianPct: 20 }),
    ]);
    expect(benchmarks.bySegment).toEqual([
      expect.objectContaining({ segment: 'irrigation', count: 1 }),
    ]);
  });
});

describe('InMemoryIntelRepository.findWinnersByReferences', () => {
  it('returns only winner rows whose canonical reference is requested', async () => {
    // Arrange — one winner, one écarté (same market), one winner of another market.
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    const beta = await repo.upsertCompetitor('STE BETA');
    await repo.insertResult(
      { reference: '62/2025/DP A/IF', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', isWinner: true },
      alpha.id,
    );
    await repo.insertResult(
      { reference: '62/2025/DP A/IF', buyerName: 'ORMVAH', bidderName: 'STE BETA', isWinner: false },
      beta.id,
    );
    await repo.insertResult(
      { reference: '99/2025', buyerName: 'ORMVAH', bidderName: 'STE BETA', isWinner: true },
      beta.id,
    );

    // Act — request the first market by its canonical key (folded case/space/punct).
    const winners = await repo.findWinnersByReferences(['62 2025 dp a if']);

    // Assert — only the winning row of the requested market comes back.
    expect(winners).toHaveLength(1);
    expect(winners[0]?.bidderName).toBe('STE ALPHA');
    expect(winners[0]?.isWinner).toBe(true);
  });

  it('returns an empty list for no keys', async () => {
    // Arrange
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    await repo.insertResult(
      { reference: 'AO/1', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', isWinner: true },
      alpha.id,
    );

    // Act / Assert
    expect(await repo.findWinnersByReferences([])).toEqual([]);
  });
});

describe('InMemoryIntelRepository.upsertResult', () => {
  it('inserts a new bid and reports the action', async () => {
    const repo = new InMemoryIntelRepository();
    const c = await repo.upsertCompetitor('STE ALPHA');

    const action = await repo.upsertResult(
      { reference: 'AO/9', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', isWinner: true },
      c.id,
    );

    expect(action).toBe('inserted');
    expect(await repo.listResults(10)).toHaveLength(1);
  });

  it('back-fills the estimation a thin notice lacked, lighting up calibration', async () => {
    // Arrange: a résultat-définitif row stored WITHOUT estimation → no rebate.
    const repo = new InMemoryIntelRepository();
    const c = await repo.upsertCompetitor('STE ALPHA');
    await repo.insertResult(
      {
        reference: 'AO/7',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        objet: "travaux d'irrigation",
        isWinner: true,
      },
      c.id,
    );
    expect((await repo.rebateBenchmarks()).sampled).toBe(0);

    // Act: the PV extract supplies the estimation for the same (ref, bidder).
    const action = await repo.upsertResult(
      {
        reference: 'AO/7',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        estimationMad: 1_000_000,
        objet: "travaux d'irrigation",
        isWinner: true,
      },
      c.id,
    );

    // Assert: enriched in place (no duplicate row) and the rebate now computes.
    expect(action).toBe('updated');
    expect(await repo.listResults(10)).toHaveLength(1);
    expect((await repo.rebateBenchmarks()).overall?.medianPct).toBe(20);
  });

  it('never erases known data with an incoming null', async () => {
    const repo = new InMemoryIntelRepository();
    const c = await repo.upsertCompetitor('STE ALPHA');
    await repo.upsertResult(
      {
        reference: 'AO/8',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        estimationMad: 1_000_000,
        isWinner: true,
      },
      c.id,
    );

    await repo.upsertResult(
      { reference: 'AO/8', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', isWinner: false },
      c.id,
    );

    const [row] = await repo.listResults(10);
    expect(row?.estimationMad).toBe(1_000_000);
    expect(row?.amountMad).toBe(800_000);
    expect(row?.isWinner).toBe(true); // winner flag is sticky
  });

  it('replaces the unknown-buyer placeholder with the real buyer from a later PV', async () => {
    const repo = new InMemoryIntelRepository();
    const c = await repo.upsertCompetitor('STE ALPHA');
    await repo.insertResult(
      {
        reference: 'AO/5',
        buyerName: 'Acheteur non précisé',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        isWinner: true,
      },
      c.id,
    );

    await repo.upsertResult(
      {
        reference: 'AO/5',
        buyerName: 'ORMVAH',
        bidderName: 'STE ALPHA',
        amountMad: 800_000,
        estimationMad: 1_000_000,
        isWinner: true,
      },
      c.id,
    );

    const [row] = await repo.listResults(10);
    expect(row?.buyerName).toBe('ORMVAH');
  });
});

describe('InMemoryIntelRepository.participationStats', () => {
  it('aggregates participation without exposing raw bids', async () => {
    // Arrange — AO/1: two bidders, alpha wins; AO/2: placeholder buyer.
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    const beta = await repo.upsertCompetitor('STE BETA');
    await repo.insertResult(
      { reference: 'AO/1', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', isWinner: true, amountMad: 900_000 },
      alpha.id,
    );
    await repo.insertResult(
      { reference: 'AO/1', buyerName: 'ORMVAH', bidderName: 'STE BETA', isWinner: false },
      beta.id,
    );
    await repo.insertResult(
      { reference: 'AO/2', buyerName: 'Acheteur non précisé', bidderName: 'STE ALPHA', isWinner: false },
      alpha.id,
    );

    // Act
    const stats = await repo.participationStats();

    // Assert — the placeholder consultation counts globally but forms no buyer row.
    expect(stats.resultsObserved).toBe(3);
    expect(stats.tendersWithResults).toBe(2);
    expect(stats.avgBiddersPerTender).toBe(1.5);
    expect(stats.byBuyer).toEqual([
      { buyerName: 'ORMVAH', tendersObserved: 1, avgBidders: 2 },
    ]);
    expect(stats.topCompetitors[0]).toEqual({
      name: 'STE ALPHA',
      participations: 2,
      wins: 1,
      totalWonMad: 900_000,
    });
  });

  it('caps byBuyer and topCompetitors at the top-N contract', async () => {
    // Arrange — more distinct buyers/bidders than the cap allows through.
    const repo = new InMemoryIntelRepository();
    for (let i = 0; i < PARTICIPATION_TOP_LIMIT + 5; i += 1) {
      const competitor = await repo.upsertCompetitor(`ENTREPRISE ${i}`);
      await repo.insertResult(
        {
          reference: `AO/${i}`,
          buyerName: `ACHETEUR ${i}`,
          bidderName: `ENTREPRISE ${i}`,
          isWinner: false,
        },
        competitor.id,
      );
    }

    // Act
    const stats = await repo.participationStats();

    // Assert — globals stay uncapped; the lists honor the contract.
    expect(stats.tendersWithResults).toBe(PARTICIPATION_TOP_LIMIT + 5);
    expect(stats.byBuyer).toHaveLength(PARTICIPATION_TOP_LIMIT);
    expect(stats.topCompetitors).toHaveLength(PARTICIPATION_TOP_LIMIT);
  });
});

/**
 * Call-counting stub for the drizzle Db — participationStats must aggregate in
 * the database: bounded execute() round-trips, never a select() full scan of
 * competitor_bid (150k-300k rows after the historical backfill).
 */
function stubParticipationDb() {
  const calls = { execute: 0, select: 0 };
  // pg returns bigint/numeric aggregates as strings — the repo must coerce.
  const resultsByCall = [
    { rows: [{ results_observed: '3', tenders_with_results: '2', avg_bidders: '1.5' }] },
    { rows: [{ buyer_name: 'ORMVAH', tenders_observed: '1', avg_bidders: '2.0' }] },
    { rows: [{ name: 'STE ALPHA', participations: '2', wins: '1', total_won_mad: '900000' }] },
  ];
  const db = {
    select: () => {
      calls.select += 1;
      throw new Error('participationStats must not full-scan via select()');
    },
    execute: async () => {
      const result = resultsByCall[calls.execute];
      calls.execute += 1;
      return result;
    },
  } as unknown as Db;
  return { db, calls };
}

describe('DrizzleIntelRepository.participationStats', () => {
  it('runs three bounded aggregate queries and coerces pg string numerics', async () => {
    const stub = stubParticipationDb();
    const repo = new DrizzleIntelRepository(stub.db);

    const stats = await repo.participationStats();

    expect(stub.calls.execute).toBe(3);
    expect(stub.calls.select).toBe(0);
    expect(stats).toEqual({
      resultsObserved: 3,
      tendersWithResults: 2,
      avgBiddersPerTender: 1.5,
      byBuyer: [{ buyerName: 'ORMVAH', tendersObserved: 1, avgBidders: 2 }],
      topCompetitors: [
        { name: 'STE ALPHA', participations: 2, wins: 1, totalWonMad: 900_000 },
      ],
    });
  });
});

/**
 * Call-counting stub for the drizzle Db — asserts HOW the repository talks to
 * Postgres (round-trip count), same pattern as tender.repository.spec.ts.
 * The InMemory implementation carries the behavioral contract above; this
 * spec guards the query SHAPE as competitor_bid grows with the PV harvest.
 */
function stubStatsDb() {
  const calls = { select: 0 };
  const statsRows = [
    { id: 'c1', canonicalName: 'SOTRAVO', wins: 2, totalMad: '1500000' },
    { id: 'c2', canonicalName: 'GTR', wins: 0, totalMad: '0' },
  ];
  const db = {
    select: () => {
      calls.select += 1;
      return {
        from: () =>
          Object.assign(Promise.resolve(statsRows), {
            leftJoin: () => ({
              groupBy: () => ({ orderBy: async () => statsRows }),
            }),
          }),
      };
    },
  } as unknown as Db;
  return { db, calls };
}

describe('DrizzleIntelRepository.listCompetitorStats', () => {
  it('aggregates in ONE grouped query — no dual full scan + JS join', async () => {
    const stub = stubStatsDb();
    const repo = new DrizzleIntelRepository(stub.db);

    const stats = await repo.listCompetitorStats();

    expect(stub.calls.select).toBe(1);
    // numeric SUM comes back as a string from pg — must be coerced.
    expect(stats).toEqual([
      { id: 'c1', canonicalName: 'SOTRAVO', wins: 2, totalMad: 1_500_000 },
      { id: 'c2', canonicalName: 'GTR', wins: 0, totalMad: 0 },
    ]);
  });
});
