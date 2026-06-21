import { describe, expect, test } from 'vitest';
import {
  projectCashflow,
  summarizeExpensesByCategory,
  type ExpenseView,
  type PaymentView,
} from './ledger.domain';

function expense(partial: Partial<ExpenseView>): ExpenseView {
  return {
    category: partial.category ?? 'materiaux',
    projectId: partial.projectId,
    amountMad: partial.amountMad ?? 1_000,
  };
}

function payment(partial: Partial<PaymentView>): PaymentView {
  return {
    projectId: partial.projectId,
    amountMad: partial.amountMad ?? 1_000,
  };
}

describe('summarizeExpensesByCategory', () => {
  test('groups expenses by category with count and total', () => {
    // Arrange
    const expenses = [
      expense({ category: 'carburant', amountMad: 300 }),
      expense({ category: 'carburant', amountMad: 200 }),
      expense({ category: 'materiaux', amountMad: 1_000 }),
    ];

    // Act
    const summary = summarizeExpensesByCategory(expenses);

    // Assert
    const carburant = summary.byCategory.find((r) => r.category === 'carburant');
    expect(carburant?.count).toBe(2);
    expect(carburant?.totalMad).toBe(500);
  });

  test('sorts categories by total spend descending and sums the grand total', () => {
    // Arrange
    const expenses = [
      expense({ category: 'carburant', amountMad: 500 }),
      expense({ category: 'materiaux', amountMad: 2_000 }),
      expense({ category: 'transport', amountMad: 800 }),
    ];

    // Act
    const summary = summarizeExpensesByCategory(expenses);

    // Assert
    expect(summary.byCategory.map((r) => r.category)).toEqual([
      'materiaux',
      'transport',
      'carburant',
    ]);
    expect(summary.totalMad).toBe(3_300);
  });

  test('returns empty breakdown and zero total when there are no expenses', () => {
    // Arrange
    const expenses: ExpenseView[] = [];

    // Act
    const summary = summarizeExpensesByCategory(expenses);

    // Assert
    expect(summary.byCategory).toHaveLength(0);
    expect(summary.totalMad).toBe(0);
  });
});

describe('projectCashflow', () => {
  test('nets incomes against expenses across all projects', () => {
    // Arrange
    const payments = [payment({ amountMad: 900_000 }), payment({ amountMad: 100_000 })];
    const expenses = [expense({ amountMad: 250_000 }), expense({ amountMad: 50_000 })];

    // Act
    const flow = projectCashflow(payments, expenses);

    // Assert
    expect(flow.incomesMad).toBe(1_000_000);
    expect(flow.expensesMad).toBe(300_000);
    expect(flow.netMad).toBe(700_000);
  });

  test('filters both sides to a single project when projectId is given', () => {
    // Arrange
    const payments = [
      payment({ projectId: 'p1', amountMad: 600_000 }),
      payment({ projectId: 'p2', amountMad: 400_000 }),
    ];
    const expenses = [
      expense({ projectId: 'p1', amountMad: 200_000 }),
      expense({ projectId: 'p2', amountMad: 999_000 }),
    ];

    // Act
    const flow = projectCashflow(payments, expenses, 'p1');

    // Assert
    expect(flow.incomesMad).toBe(600_000);
    expect(flow.expensesMad).toBe(200_000);
    expect(flow.netMad).toBe(400_000);
  });

  test('reports a negative net when a chantier spends more than it receives', () => {
    // Arrange
    const payments = [payment({ projectId: 'p1', amountMad: 100_000 })];
    const expenses = [expense({ projectId: 'p1', amountMad: 175_000 })];

    // Act
    const flow = projectCashflow(payments, expenses, 'p1');

    // Assert
    expect(flow.netMad).toBe(-75_000);
  });
});
