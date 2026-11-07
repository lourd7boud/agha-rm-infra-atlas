import { describe, expect, it } from 'vitest';
import { computeCoutsTerrain } from './btp-terrain.domain';

describe('terrain cost integrity', () => {
  it('adds only reconciled standalone expenses to known costs', () => {
    const result = computeCoutsTerrain({
      mainOeuvreMad: 100,
      materielMad: 200,
      consommationsMad: 300,
      depensesMad: 900,
      decompteCumuleTtcMad: 2000,
      montantMarcheMad: 5000,
      reconciledExpensesMad: 250,
      expensesAwaitingReconciliationMad: 150,
      unresolvedExpenseCount: 1,
      reconciledExpenseCount: 3,
    });
    expect(result).toMatchObject({
      operationalResourceCostsMad: 600,
      knownCostsMad: 850,
      reconciledExpensesMad: 250,
      expensesAwaitingReconciliationMad: 150,
      unresolvedExpenseCount: 1,
      reconciledExpenseCount: 3,
      margeBruteMad: null,
      totalMad: null,
    });
  });
  it('keeps potentially duplicate expenses outside resource costs and withholds profit', () => {
    const result = computeCoutsTerrain({
      mainOeuvreMad: 100,
      materielMad: 200,
      consommationsMad: 300,
      depensesMad: 300,
      decompteCumuleTtcMad: 2000,
      montantMarcheMad: 5000,
    });
    expect(result).toMatchObject({
      operationalResourceCostsMad: 600,
      expensesAwaitingReconciliationMad: 300,
      totalMad: null,
      margeBruteMad: null,
      coutSurMarchePct: null,
      reconciliationStatus: 'pending',
      costBasis: 'unreconciled',
    });
  });

  it('does not claim profit for an empty ledger', () => {
    const result = computeCoutsTerrain({
      mainOeuvreMad: 0,
      materielMad: 0,
      consommationsMad: 0,
      depensesMad: 0,
      decompteCumuleTtcMad: 2000,
      montantMarcheMad: 5000,
    });
    expect(result.margeBruteMad).toBeNull();
    expect(result.totalMad).toBeNull();
  });
});
