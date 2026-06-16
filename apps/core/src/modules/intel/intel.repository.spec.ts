import { describe, expect, it } from 'vitest';
import { InMemoryIntelRepository } from './intel.repository';

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
