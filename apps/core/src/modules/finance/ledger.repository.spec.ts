import { describe, expect, test } from 'vitest';
import {
  InMemoryFinanceLedgerRepository,
  type CreateExpense,
  type CreatePayment,
} from './ledger.repository';

const AT = new Date('2026-06-01T00:00:00Z');

function paymentInput(partial: Partial<CreatePayment>): CreatePayment {
  return {
    projectId: partial.projectId,
    label: partial.label ?? 'Décompte 1 — DRETLH',
    payerName: partial.payerName,
    amountMad: partial.amountMad ?? 900_000,
    method: partial.method ?? 'virement',
    transferReference: partial.transferReference,
    bankName: partial.bankName,
    paidAt: partial.paidAt ?? AT,
    notes: partial.notes,
  };
}

function expenseInput(partial: Partial<CreateExpense>): CreateExpense {
  return {
    projectId: partial.projectId,
    category: partial.category ?? 'materiaux',
    label: partial.label ?? 'Ciment CPJ 45',
    amountMad: partial.amountMad ?? 12_000,
    method: partial.method,
    reference: partial.reference,
    supplierId: partial.supplierId,
    spentAt: partial.spentAt ?? AT,
    notes: partial.notes,
  };
}

describe('InMemoryFinanceLedgerRepository — payments', () => {
  test('createPayment returns a persisted record with id and createdAt', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();

    // Act
    const record = await repo.createPayment(paymentInput({ amountMad: 500_000 }));

    // Assert
    expect(record.id).toBeTruthy();
    expect(record.amountMad).toBe(500_000);
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  test('listPayments filters by projectId', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ projectId: 'p1', amountMad: 100 }));
    await repo.createPayment(paymentInput({ projectId: 'p2', amountMad: 200 }));

    // Act
    const rows = await repo.listPayments({ projectId: 'p1' });

    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountMad).toBe(100);
  });

  test('listPayments respects the limit', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ amountMad: 1 }));
    await repo.createPayment(paymentInput({ amountMad: 2 }));
    await repo.createPayment(paymentInput({ amountMad: 3 }));

    // Act
    const rows = await repo.listPayments({ limit: 2 });

    // Assert
    expect(rows).toHaveLength(2);
  });
});

describe('InMemoryFinanceLedgerRepository — expenses', () => {
  test('createExpense returns a persisted record', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();

    // Act
    const record = await repo.createExpense(
      expenseInput({ category: 'carburant', amountMad: 800 }),
    );

    // Assert
    expect(record.id).toBeTruthy();
    expect(record.category).toBe('carburant');
    expect(record.amountMad).toBe(800);
  });

  test('listExpenses filters by category and projectId together', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createExpense(
      expenseInput({ projectId: 'p1', category: 'carburant', amountMad: 100 }),
    );
    await repo.createExpense(
      expenseInput({ projectId: 'p1', category: 'materiaux', amountMad: 200 }),
    );
    await repo.createExpense(
      expenseInput({ projectId: 'p2', category: 'carburant', amountMad: 300 }),
    );

    // Act
    const rows = await repo.listExpenses({ projectId: 'p1', category: 'carburant' });

    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountMad).toBe(100);
  });
});

describe('InMemoryFinanceLedgerRepository — summaries', () => {
  test('expenseSummary groups by category and totals across all expenses', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createExpense(expenseInput({ category: 'carburant', amountMad: 300 }));
    await repo.createExpense(expenseInput({ category: 'carburant', amountMad: 200 }));
    await repo.createExpense(expenseInput({ category: 'materiaux', amountMad: 1_000 }));

    // Act
    const summary = await repo.expenseSummary();

    // Assert
    expect(summary.totalMad).toBe(1_500);
    expect(summary.byCategory[0]?.category).toBe('materiaux');
    const carburant = summary.byCategory.find((r) => r.category === 'carburant');
    expect(carburant?.count).toBe(2);
  });

  test('cashflow nets payments against expenses for a given project', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ projectId: 'p1', amountMad: 600_000 }));
    await repo.createPayment(paymentInput({ projectId: 'p2', amountMad: 400_000 }));
    await repo.createExpense(expenseInput({ projectId: 'p1', amountMad: 250_000 }));

    // Act
    const flow = await repo.cashflow('p1');

    // Assert
    expect(flow.incomesMad).toBe(600_000);
    expect(flow.expensesMad).toBe(250_000);
    expect(flow.netMad).toBe(350_000);
  });
});
