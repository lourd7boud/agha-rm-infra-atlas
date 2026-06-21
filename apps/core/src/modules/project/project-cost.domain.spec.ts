import { describe, expect, test } from 'vitest';
import {
  computeProjectCost,
  mergeCostSummary,
  type ComponentByProject,
  type ProjectBudgetRef,
} from './project-cost.domain';

describe('computeProjectCost', () => {
  test('sums the three components into the total cost', () => {
    // Arrange
    const input = {
      budgetMad: 5_000_000,
      materialsCostMad: 1_080,
      laborCostMad: 14_800,
      expensesMad: 250_000,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert
    expect(cost.coutTotalMad).toBe(265_880);
  });

  test('remaining budget is budget minus total cost', () => {
    // Arrange
    const input = {
      budgetMad: 5_000_000,
      materialsCostMad: 1_080,
      laborCostMad: 14_800,
      expensesMad: 250_000,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert
    expect(cost.restantMad).toBe(4_734_120);
  });

  test('margin is the remaining share of the budget as a percentage', () => {
    // Arrange — total cost 250 000 on a 1 000 000 budget → 750 000 remaining = 75%.
    const input = {
      budgetMad: 1_000_000,
      materialsCostMad: 100_000,
      laborCostMad: 100_000,
      expensesMad: 50_000,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert
    expect(cost.restantMad).toBe(750_000);
    expect(cost.margePct).toBe(75);
  });

  test('margin is 0 (not NaN) when the budget is 0', () => {
    // Arrange
    const input = {
      budgetMad: 0,
      materialsCostMad: 10,
      laborCostMad: 20,
      expensesMad: 30,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert — no usable budget yields a defined 0 margin, never a division by 0.
    expect(cost.margePct).toBe(0);
    expect(cost.restantMad).toBe(-60);
  });

  test('a cost exceeding the budget yields a negative remaining (dépassement)', () => {
    // Arrange
    const input = {
      budgetMad: 100_000,
      materialsCostMad: 80_000,
      laborCostMad: 50_000,
      expensesMad: 0,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert
    expect(cost.coutTotalMad).toBe(130_000);
    expect(cost.restantMad).toBe(-30_000);
    expect(cost.margePct).toBe(-30);
  });

  test('carries incomesMad through without folding it into the cost', () => {
    // Arrange
    const input = {
      budgetMad: 5_000_000,
      materialsCostMad: 1_080,
      laborCostMad: 14_800,
      expensesMad: 250_000,
      incomesMad: 600_000,
    };

    // Act
    const cost = computeProjectCost(input);

    // Assert — incomes surfaced but cost untouched (recettes are not a cost).
    expect(cost.incomesMad).toBe(600_000);
    expect(cost.coutTotalMad).toBe(265_880);
  });
});

describe('mergeCostSummary', () => {
  const projects: ProjectBudgetRef[] = [
    { projectId: 'proj-1', montantMarcheMad: 5_000_000 },
    { projectId: 'proj-2', montantMarcheMad: 1_000_000 },
  ];

  test('looks up each component per project and computes its cost', () => {
    // Arrange
    const materials: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 1_080 },
    ];
    const labor: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 14_800 },
    ];
    const expenses: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 250_000 },
    ];
    const incomes: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 600_000 },
    ];

    // Act
    const summary = mergeCostSummary(
      projects,
      materials,
      labor,
      expenses,
      incomes,
    );

    // Assert
    const p1 = summary.find((s) => s.projectId === 'proj-1');
    expect(p1?.coutTotalMad).toBe(265_880);
    expect(p1?.restantMad).toBe(4_734_120);
    expect(p1?.incomesMad).toBe(600_000);
  });

  test('defaults a missing component to 0, leaving the full budget remaining', () => {
    // Arrange — proj-2 has no materials, labor, expenses or incomes at all.
    const materials: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 1_080 },
    ];

    // Act
    const summary = mergeCostSummary(projects, materials, [], [], []);

    // Assert — proj-2 surfaces with 0 cost and its full budget remaining.
    const p2 = summary.find((s) => s.projectId === 'proj-2');
    expect(p2?.coutTotalMad).toBe(0);
    expect(p2?.restantMad).toBe(1_000_000);
    expect(p2?.margePct).toBe(100);
    expect(p2?.materialsCostMad).toBe(0);
  });

  test('returns one summary per project, keyed by projectId', () => {
    // Arrange + Act
    const summary = mergeCostSummary(projects, [], [], [], []);

    // Assert
    expect(summary).toHaveLength(2);
    expect(summary.map((s) => s.projectId).sort()).toEqual([
      'proj-1',
      'proj-2',
    ]);
  });

  test('folds multiple component rows for the same project', () => {
    // Arrange — two materials rows for proj-1 (e.g. two materials consumed).
    const materials: ComponentByProject[] = [
      { projectId: 'proj-1', amountMad: 1_000 },
      { projectId: 'proj-1', amountMad: 500 },
    ];

    // Act
    const summary = mergeCostSummary(projects, materials, [], [], []);

    // Assert
    const p1 = summary.find((s) => s.projectId === 'proj-1');
    expect(p1?.materialsCostMad).toBe(1_500);
  });
});
