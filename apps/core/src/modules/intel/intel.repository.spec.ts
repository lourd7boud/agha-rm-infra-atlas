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
