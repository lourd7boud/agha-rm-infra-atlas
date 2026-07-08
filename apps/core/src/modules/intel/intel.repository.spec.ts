import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import { DrizzleIntelRepository, InMemoryIntelRepository } from './intel.repository';
import { PARTICIPATION_TOP_LIMIT } from './participation.domain';
import { buildInventory, type InventoryRow } from '../tender/inventory.domain';

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

  it('does NOT fold an unknown-buyer bid into a real buyer (attribution would be a guess)', async () => {
    // A résultat-définitif with no parseable buyer lands as the placeholder. A
    // later PV naming a real buyer for the SAME (reference, competitor) is NOT
    // provably the same market — a generic "AO/5" may belong to any of 654
    // acheteurs — so it must NOT overwrite the placeholder (the old (reference,
    // competitor) key did, guessing the attribution). Both rows are kept; the
    // placeholder still counts in the GLOBAL participation total but is attributed
    // to no buyer. The real buyer's bid stands on its own row.
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

    const action = await repo.upsertResult(
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

    expect(action).toBe('inserted');
    const rows = await repo.listResults(10);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.buyerName).sort()).toEqual([
      'Acheteur non précisé',
      'ORMVAH',
    ]);
  });
});

describe('InMemoryIntelRepository buyer-scoped bid identity', () => {
  // Portal references (e.g. "05/2026") are reused across 654 distinct acheteurs.
  // Keying a bid on (reference, competitor) ALONE merged one competitor's bids on
  // two DIFFERENT buyers' markets into a single row — clobbering amount, sticky-
  // OR'ing isWinner, overwriting buyerName. The buyer must be part of the identity.
  it('keeps upserts from two buyers that share one generic reference as separate rows', async () => {
    // Arrange — the SAME competitor bids on the SAME generic reference for two buyers.
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    await repo.upsertResult(
      {
        reference: '05/2026',
        buyerName: 'Commune de Rabat',
        bidderName: 'STE ALPHA',
        amountMad: 500_000,
        isWinner: true,
      },
      alpha.id,
    );

    // Act — a bid on the same reference but a DIFFERENT buyer.
    const action = await repo.upsertResult(
      {
        reference: '05/2026',
        buyerName: 'Province de Safi',
        bidderName: 'STE ALPHA',
        amountMad: 700_000,
        isWinner: false,
      },
      alpha.id,
    );

    // Assert — a new row, not a merge; each buyer keeps its own amount + winner flag.
    expect(action).toBe('inserted');
    const rows = await repo.listResults(10);
    expect(rows).toHaveLength(2);
    const rabat = rows.find((r) => r.buyerName === 'Commune de Rabat');
    const safi = rows.find((r) => r.buyerName === 'Province de Safi');
    expect(rabat?.amountMad).toBe(500_000);
    expect(rabat?.isWinner).toBe(true);
    expect(safi?.amountMad).toBe(700_000);
    expect(safi?.isWinner).toBe(false);
  });

  it('does not treat a second buyer as a duplicate on insertResult', async () => {
    // Arrange
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');

    // Act — two inserts, same reference + competitor, different buyers.
    const first = await repo.insertResult(
      { reference: '05/2026', buyerName: 'Commune de Rabat', bidderName: 'STE ALPHA', isWinner: true },
      alpha.id,
    );
    const second = await repo.insertResult(
      { reference: '05/2026', buyerName: 'Province de Safi', bidderName: 'STE ALPHA', isWinner: true },
      alpha.id,
    );

    // Assert — neither is rejected as a duplicate; both markets are recorded.
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(await repo.listResults(10)).toHaveLength(2);
  });

  it('still merges a re-harvest of the SAME (reference, buyer, competitor)', async () => {
    // The identity widened by buyer — it must NOT widen so far that a genuine
    // re-harvest of one buyer's market stops enriching in place.
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    await repo.insertResult(
      { reference: '05/2026', buyerName: 'Commune de Rabat', bidderName: 'STE ALPHA', amountMad: 500_000, isWinner: true },
      alpha.id,
    );

    const action = await repo.upsertResult(
      { reference: '05/2026', buyerName: 'Commune de Rabat', bidderName: 'STE ALPHA', estimationMad: 600_000, isWinner: true },
      alpha.id,
    );

    expect(action).toBe('updated');
    const rows = await repo.listResults(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountMad).toBe(500_000); // preserved
    expect(rows[0]?.estimationMad).toBe(600_000); // enriched
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

describe('InMemoryIntelRepository.listResultMarkets (deduped, OOM-safe lifecycle source)', () => {
  const NOW = new Date('2026-06-13T00:00:00Z');
  function pastTender(reference: string, buyerName: string): InventoryRow {
    return {
      id: `t-${reference}`,
      reference,
      buyerName,
      procedure: 'AOO',
      objet: 'Travaux divers',
      deadlineAt: new Date('2026-05-01T00:00:00Z'), // past NOW → lifecycle set by bids
      pipelineState: 'detected',
      createdAt: NOW,
      updatedAt: NOW,
      region: 'Rabat-Salé-Kénitra',
      ville: null,
      category: 'Travaux',
      secteur: 'Génie civil',
      lotCount: 1,
    };
  }

  it('folds many bids to one market row and yields the SAME lifecycle facet + winner as the full bid set', async () => {
    const repo = new InMemoryIntelRepository();
    const alpha = await repo.upsertCompetitor('STE ALPHA');
    const beta = await repo.upsertCompetitor('STE BETA');
    // Market AO/1 (ORMVAH): winner ALPHA + loser BETA → attribué.
    await repo.insertResult(
      { reference: 'AO/1', buyerName: 'ORMVAH', bidderName: 'STE ALPHA', amountMad: 800_000, isWinner: true, resultDate: new Date('2026-05-10T00:00:00Z') },
      alpha.id,
    );
    await repo.insertResult(
      { reference: 'AO/1', buyerName: 'ORMVAH', bidderName: 'STE BETA', amountMad: 900_000, isWinner: false, resultDate: new Date('2026-05-10T00:00:00Z') },
      beta.id,
    );
    // Market AO/2 (Commune X): bids but NO winner → infructueux.
    await repo.insertResult(
      { reference: 'AO/2', buyerName: 'Commune X', bidderName: 'STE BETA', amountMad: 500_000, isWinner: false, resultDate: new Date('2026-05-11T00:00:00Z') },
      beta.id,
    );

    const rawBids = await repo.listAllBids();
    const markets = await repo.listResultMarkets();
    // 3 bids collapse to 2 markets — the whole point (no full-table load).
    expect(rawBids).toHaveLength(3);
    expect(markets).toHaveLength(2);
    const m1 = markets.find((m) => m.reference === 'AO/1')!;
    expect(m1.isWinner).toBe(true);
    expect(m1.bidderName).toBe('STE ALPHA');
    expect(m1.amountMad).toBe(800_000);
    const m2 = markets.find((m) => m.reference === 'AO/2')!;
    expect(m2.isWinner).toBe(false);

    // PARITY: lifecycle facet + per-row winner/lifecycle are identical whether the
    // fold reads the full 3-bid set or the deduped 2-market set.
    const tenders = [pastTender('AO/1', 'ORMVAH'), pastTender('AO/2', 'Commune X')];
    const fromBids = buildInventory(tenders, {}, NOW, {}, rawBids);
    const fromMarkets = buildInventory(tenders, {}, NOW, {}, markets);
    expect(fromMarkets.facets.lifecycles).toEqual(fromBids.facets.lifecycles);
    expect(fromBids.facets.lifecycles).toEqual([
      { key: 'attribue', label: 'Attribué', count: 1 },
      { key: 'infructueux', label: 'Infructueux', count: 1 },
    ]);
    for (const ref of ['AO/1', 'AO/2']) {
      const fb = fromBids.items.find((i) => i.reference === ref)!;
      const fm = fromMarkets.items.find((i) => i.reference === ref)!;
      expect(fm.lifecycleStatus).toBe(fb.lifecycleStatus);
      expect(fm.winner?.bidderName).toBe(fb.winner?.bidderName);
      expect(fm.winner?.amountMad).toBe(fb.winner?.amountMad);
    }
  });
});
