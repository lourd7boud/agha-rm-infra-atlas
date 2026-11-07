import { describe, expect, test } from 'vitest';
import {
  ACCOUNTING_PROJECTION_BADGES,
  INVOICE_SETTLEMENT_BADGES,
  INVOICE_STATUS_BADGES,
  fmtCentsMad,
  parseInvoiceAggregate,
  type AccountingProjectionStatus,
  type InvoiceSettlementState,
  type InvoiceStatus,
} from './sales';

const aggregate = {
  invoice: {
    id: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222',
    reference: 'FAC-2026-000001',
    invoiceDate: '2026-11-07',
    status: 'emise',
    totalHtMad: 1000,
    tvaPct: 20,
    tvaMad: 200,
    totalTtcMad: 1200,
    version: 2,
    legacyPaid: false,
    createdAt: '2026-11-07T12:00:00.000Z',
    lines: [],
  },
  payments: [],
  creditNotes: [],
  settlement: {
    state: 'partiellement_payee',
    netInvoiceCents: 120000,
    netReceivedCents: 40001,
    outstandingCents: 79999,
    customerCreditCents: 0,
  },
  accountingProjection: 'blocked',
  legacyPaidOpening: false,
};

describe('sales accounting web contract', () => {
  test('has exhaustive labels for every server state', () => {
    const lifecycle: InvoiceStatus[] = [
      'brouillon',
      'emise',
      'annulee',
      'envoyee',
      'payee',
    ];
    const settlements: InvoiceSettlementState[] = [
      'non_reglee',
      'partiellement_payee',
      'payee',
      'solde_crediteur',
      'remboursee',
    ];
    const projections: AccountingProjectionStatus[] = [
      'pending',
      'projected',
      'blocked',
    ];

    expect(lifecycle.map((state) => INVOICE_STATUS_BADGES[state].label)).toHaveLength(5);
    expect(settlements.map((state) => INVOICE_SETTLEMENT_BADGES[state].label)).toHaveLength(5);
    expect(projections.map((state) => ACCOUNTING_PROJECTION_BADGES[state].label)).toHaveLength(3);
  });

  test('formats authoritative centimes without binary re-rounding', () => {
    expect(fmtCentsMad(79_999)).toContain('799,99');
    expect(fmtCentsMad(1)).toContain('0,01');
  });

  test('parses a complete aggregate and rejects an incomplete response', () => {
    expect(parseInvoiceAggregate(aggregate).settlement.outstandingCents).toBe(79_999);
    expect(() =>
      parseInvoiceAggregate({ ...aggregate, accountingProjection: 'unknown' }),
    ).toThrow(/projection/i);
    expect(() => parseInvoiceAggregate({ invoice: aggregate.invoice })).toThrow(
      /agrégat/i,
    );
  });
});
