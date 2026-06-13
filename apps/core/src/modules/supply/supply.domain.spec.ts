import { describe, expect, test } from 'vitest';
import { buildPayables, type PayableInput } from './supply.domain';

const TODAY = new Date('2026-06-12T00:00:00Z');
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

function invoice(partial: Partial<PayableInput>): PayableInput {
  return {
    supplierName: partial.supplierName ?? 'SOMACEM',
    reference: partial.reference ?? 'F-001',
    amountMad: partial.amountMad ?? 50_000,
    dueDate: partial.dueDate ?? daysAgo(10),
    status: partial.status ?? 'validee',
  };
}

describe('buildPayables', () => {
  test('only validated unpaid invoices become payables', () => {
    const result = buildPayables(
      [
        invoice({ status: 'validee', amountMad: 50_000 }),
        invoice({ status: 'payee', amountMad: 80_000, reference: 'F-002' }),
        invoice({ status: 'recue', amountMad: 20_000, reference: 'F-003' }),
      ],
      TODAY,
    );

    expect(result.items).toHaveLength(1);
    expect(result.totalMad).toBe(50_000);
  });

  test('overdue days and aging buckets mirror the receivables side', () => {
    const result = buildPayables(
      [
        invoice({ reference: 'F-1', dueDate: daysAgo(15), amountMad: 100 }),
        invoice({ reference: 'F-2', dueDate: daysAgo(45), amountMad: 200 }),
        invoice({ reference: 'F-3', dueDate: daysAgo(75), amountMad: 300 }),
        invoice({ reference: 'F-4', dueDate: daysAgo(120), amountMad: 400 }),
      ],
      TODAY,
    );

    expect(result.aging['0-30']).toBe(100);
    expect(result.aging['31-60']).toBe(200);
    expect(result.aging['61-90']).toBe(300);
    expect(result.aging['90+']).toBe(400);
    // chase order: most overdue first
    expect(result.items[0]?.reference).toBe('F-4');
  });

  test('not-yet-due invoices count as 0 days overdue', () => {
    const result = buildPayables(
      [invoice({ dueDate: daysAhead(20), amountMad: 999 })],
      TODAY,
    );

    expect(result.items[0]?.daysOverdue).toBe(0);
    expect(result.aging['0-30']).toBe(999);
  });

  test('totals per supplier rank the heaviest creditor first', () => {
    const result = buildPayables(
      [
        invoice({ supplierName: 'SOMACEM', amountMad: 100, reference: 'A' }),
        invoice({ supplierName: 'ACIER SUD', amountMad: 500, reference: 'B' }),
        invoice({ supplierName: 'SOMACEM', amountMad: 150, reference: 'C' }),
      ],
      TODAY,
    );

    expect(result.parFournisseur[0]).toEqual({
      supplierName: 'ACIER SUD',
      totalMad: 500,
      factures: 1,
    });
    expect(result.parFournisseur[1]?.totalMad).toBe(250);
  });
});
