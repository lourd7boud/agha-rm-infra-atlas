import { describe, expect, test } from 'vitest';
import { straightLineDepreciation } from './equipment.depreciation.domain';

describe('straightLineDepreciation', () => {
  test('is not applicable without cost, months and acquisition date', () => {
    const r = straightLineDepreciation(
      { acquisitionCostMad: 500_000 },
      new Date('2025-01-01'),
    );
    expect(r.applicable).toBe(false);
    expect(r.bookValueMad).toBeNull();
  });

  test('computes the book value halfway through the schedule (with salvage)', () => {
    const r = straightLineDepreciation(
      {
        acquisitionCostMad: 1_000_000,
        acquisitionDate: new Date('2020-01-01'),
        depreciationMonths: 120,
        salvageValueMad: 100_000,
      },
      new Date('2025-01-01'),
    );
    expect(r.applicable).toBe(true);
    expect(r.totalMonths).toBe(120);
    expect(r.elapsedMonths).toBe(60);
    expect(r.monthlyMad).toBe(7500);
    expect(r.accumulatedMad).toBe(450_000);
    expect(r.bookValueMad).toBe(550_000);
    expect(r.fullyDepreciated).toBe(false);
  });

  test('floors at the salvage value once fully depreciated', () => {
    const r = straightLineDepreciation(
      {
        acquisitionCostMad: 1_000_000,
        acquisitionDate: new Date('2020-01-01'),
        depreciationMonths: 120,
        salvageValueMad: 100_000,
      },
      new Date('2035-01-01'),
    );
    expect(r.fullyDepreciated).toBe(true);
    expect(r.accumulatedMad).toBe(900_000);
    expect(r.bookValueMad).toBe(100_000);
  });

  test('defaults salvage to zero and returns full cost at acquisition', () => {
    const r = straightLineDepreciation(
      {
        acquisitionCostMad: 500_000,
        acquisitionDate: new Date('2020-01-01'),
        depreciationMonths: 60,
      },
      new Date('2020-01-01'),
    );
    expect(r.elapsedMonths).toBe(0);
    expect(r.accumulatedMad).toBe(0);
    expect(r.bookValueMad).toBe(500_000);
    expect(r.monthlyMad).toBeCloseTo(500_000 / 60);
  });
});
