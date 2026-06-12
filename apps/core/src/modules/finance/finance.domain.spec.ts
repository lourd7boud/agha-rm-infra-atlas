import { describe, expect, test } from 'vitest';
import {
  buildReceivables,
  summarizeCautions,
  type CautionView,
  type ReceivableInput,
} from './finance.domain';

const TODAY = new Date('2026-06-12T00:00:00Z');
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

function caution(partial: Partial<CautionView>): CautionView {
  return {
    kind: partial.kind ?? 'provisoire',
    amountMad: partial.amountMad ?? 50_000,
    issuedAt: partial.issuedAt ?? daysAgo(30),
    status: partial.status ?? 'active',
  };
}

describe('summarizeCautions', () => {
  test('totals active cautions by kind and ignores released ones', () => {
    const summary = summarizeCautions(
      [
        caution({ kind: 'provisoire', amountMad: 90_000 }),
        caution({ kind: 'definitive', amountMad: 150_000 }),
        caution({ kind: 'provisoire', amountMad: 40_000, status: 'liberee' }),
      ],
      TODAY,
    );

    expect(summary.activeTotalMad).toBe(240_000);
    expect(summary.byKind.provisoire).toBe(90_000);
    expect(summary.byKind.definitive).toBe(150_000);
    expect(summary.activeCount).toBe(2);
  });

  test('flags cautions locked for more than a year', () => {
    const summary = summarizeCautions(
      [
        caution({ amountMad: 90_000, issuedAt: daysAgo(400) }),
        caution({ amountMad: 10_000, issuedAt: daysAgo(10) }),
      ],
      TODAY,
    );

    expect(summary.staleCount).toBe(1);
    expect(summary.staleTotalMad).toBe(90_000);
  });
});

function receivable(partial: Partial<ReceivableInput>): ReceivableInput {
  return {
    projectReference: partial.projectReference ?? 'MARCHE 1/2026/X',
    buyerName: partial.buyerName ?? 'DRETLH',
    numero: partial.numero ?? 1,
    netAPayerMad: partial.netAPayerMad ?? 900_000,
    periodEnd: partial.periodEnd ?? daysAgo(15),
    status: partial.status ?? 'valide',
  };
}

describe('buildReceivables', () => {
  test('only validated (unpaid) situations become receivables', () => {
    const result = buildReceivables(
      [
        receivable({ status: 'valide', netAPayerMad: 900_000 }),
        receivable({ status: 'paye', netAPayerMad: 500_000 }),
        receivable({ status: 'brouillon', netAPayerMad: 100_000 }),
      ],
      TODAY,
    );

    expect(result.items).toHaveLength(1);
    expect(result.totalMad).toBe(900_000);
  });

  test('computes days outstanding and aging buckets', () => {
    const result = buildReceivables(
      [
        receivable({ numero: 1, periodEnd: daysAgo(15), netAPayerMad: 100 }),
        receivable({ numero: 2, periodEnd: daysAgo(45), netAPayerMad: 200 }),
        receivable({ numero: 3, periodEnd: daysAgo(75), netAPayerMad: 300 }),
        receivable({ numero: 4, periodEnd: daysAgo(120), netAPayerMad: 400 }),
      ],
      TODAY,
    );

    const youngest = result.items.find((item) => item.numero === 1);
    expect(youngest?.daysOutstanding).toBe(15);
    expect(result.aging['0-30']).toBe(100);
    expect(result.aging['31-60']).toBe(200);
    expect(result.aging['61-90']).toBe(300);
    expect(result.aging['90+']).toBe(400);
  });

  test('sorts items oldest first — chase priority', () => {
    const result = buildReceivables(
      [
        receivable({ numero: 1, periodEnd: daysAgo(5) }),
        receivable({ numero: 2, periodEnd: daysAgo(80) }),
      ],
      TODAY,
    );

    expect(result.items[0]?.numero).toBe(2);
  });
});
