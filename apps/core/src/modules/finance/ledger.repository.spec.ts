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

  test('listPayments filters by projectId and reports the filtered total', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ projectId: 'p1', amountMad: 100 }));
    await repo.createPayment(paymentInput({ projectId: 'p2', amountMad: 200 }));

    // Act
    const page = await repo.listPayments(
      { projectId: 'p1' },
      { limit: 25, offset: 0 },
    );

    // Assert — total is the count of the filtered set, not all rows.
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.amountMad).toBe(100);
  });

  test('listPayments returns one bounded page but the full total', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ amountMad: 1 }));
    await repo.createPayment(paymentInput({ amountMad: 2 }));
    await repo.createPayment(paymentInput({ amountMad: 3 }));

    // Act
    const page = await repo.listPayments({}, { limit: 2, offset: 0 });

    // Assert — page holds LIMIT rows; total counts every matching row.
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  test('listPayments applies the offset for the second page', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ amountMad: 1 }));
    await repo.createPayment(paymentInput({ amountMad: 2 }));
    await repo.createPayment(paymentInput({ amountMad: 3 }));

    // Act
    const page = await repo.listPayments({}, { limit: 2, offset: 2 });

    // Assert — only the tail row remains, total still reflects all rows.
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
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
    const page = await repo.listExpenses(
      { projectId: 'p1', category: 'carburant' },
      { limit: 25, offset: 0 },
    );

    // Assert — one row matches both filters; total reflects that filtered set.
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.amountMad).toBe(100);
  });

  test('listExpenses returns one bounded page but the full total', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createExpense(expenseInput({ amountMad: 1 }));
    await repo.createExpense(expenseInput({ amountMad: 2 }));
    await repo.createExpense(expenseInput({ amountMad: 3 }));

    // Act
    const page = await repo.listExpenses({}, { limit: 2, offset: 0 });

    // Assert — page holds LIMIT rows; total counts every matching row.
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
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

describe('InMemoryFinanceLedgerRepository — per-project aggregates', () => {
  test('expensesByProject sums dépenses per project, skipping null project rows', async () => {
    // Arrange — two projects plus an unscoped dépense that must not appear.
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createExpense(expenseInput({ projectId: 'p1', amountMad: 250_000 }));
    await repo.createExpense(expenseInput({ projectId: 'p1', amountMad: 50_000 }));
    await repo.createExpense(expenseInput({ projectId: 'p2', amountMad: 100_000 }));
    await repo.createExpense(expenseInput({ amountMad: 9_999 }));

    // Act
    const totals = await repo.expensesByProject();

    // Assert — one row per project; the null-project dépense is excluded.
    expect(totals).toHaveLength(2);
    expect(totals.find((t) => t.projectId === 'p1')?.totalMad).toBe(300_000);
    expect(totals.find((t) => t.projectId === 'p2')?.totalMad).toBe(100_000);
  });

  test('paymentsByProject sums recettes per project, skipping null project rows', async () => {
    // Arrange
    const repo = new InMemoryFinanceLedgerRepository();
    await repo.createPayment(paymentInput({ projectId: 'p1', amountMad: 600_000 }));
    await repo.createPayment(paymentInput({ projectId: 'p1', amountMad: 100_000 }));
    await repo.createPayment(paymentInput({ amountMad: 7_777 }));

    // Act
    const totals = await repo.paymentsByProject();

    // Assert — p1 folded across two rows; the unscoped recette is excluded.
    expect(totals).toHaveLength(1);
    expect(totals.find((t) => t.projectId === 'p1')?.totalMad).toBe(700_000);
  });
});
