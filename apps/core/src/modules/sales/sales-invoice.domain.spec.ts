import { describe, expect, test } from 'vitest';
import {
  SalesInvoiceDomainError,
  allocateCreditNote,
  assertInvoiceTransition,
  deriveSettlement,
  summarizePaymentMovements,
} from './sales-invoice.domain';

describe('invoice lifecycle', () => {
  test('allows draft issue and issued cancellation while keeping retries idempotent', () => {
    expect(assertInvoiceTransition('brouillon', 'emise')).toBe('emise');
    expect(assertInvoiceTransition('emise', 'annulee')).toBe('annulee');
    expect(assertInvoiceTransition('emise', 'emise')).toBe('emise');
  });

  test('rejects attempts to reopen or skip the official issue step', () => {
    expect(() => assertInvoiceTransition('emise', 'brouillon')).toThrow(
      SalesInvoiceDomainError,
    );
    expect(() => assertInvoiceTransition('brouillon', 'annulee')).toThrow(
      /transition/i,
    );
    expect(() => assertInvoiceTransition('annulee', 'emise')).toThrow(
      /transition/i,
    );
  });
});

describe('invoice settlement', () => {
  test.each([
    {
      name: 'unpaid',
      input: {
        totalCents: 12_000,
        receivedCents: 0,
        creditedCents: 0,
        refundedCents: 0,
      },
      expected: {
        state: 'non_reglee',
        outstandingCents: 12_000,
        customerCreditCents: 0,
      },
    },
    {
      name: 'partially paid',
      input: {
        totalCents: 12_000,
        receivedCents: 5_000,
        creditedCents: 0,
        refundedCents: 0,
      },
      expected: {
        state: 'partiellement_payee',
        outstandingCents: 7_000,
        customerCreditCents: 0,
      },
    },
    {
      name: 'paid exactly',
      input: {
        totalCents: 12_000,
        receivedCents: 12_000,
        creditedCents: 0,
        refundedCents: 0,
      },
      expected: {
        state: 'payee',
        outstandingCents: 0,
        customerCreditCents: 0,
      },
    },
    {
      name: 'customer credit',
      input: {
        totalCents: 12_000,
        receivedCents: 12_500,
        creditedCents: 0,
        refundedCents: 0,
      },
      expected: {
        state: 'solde_crediteur',
        outstandingCents: 0,
        customerCreditCents: 500,
      },
    },
    {
      name: 'fully refunded after a full credit note',
      input: {
        totalCents: 12_000,
        receivedCents: 12_000,
        creditedCents: 12_000,
        refundedCents: 12_000,
      },
      expected: {
        state: 'remboursee',
        outstandingCents: 0,
        customerCreditCents: 0,
      },
    },
    {
      name: 'fully settled by a credit note without a cash refund',
      input: {
        totalCents: 12_000,
        receivedCents: 0,
        creditedCents: 12_000,
        refundedCents: 0,
      },
      expected: {
        state: 'payee',
        outstandingCents: 0,
        customerCreditCents: 0,
      },
    },
  ])('derives $name from authoritative centime aggregates', ({ input, expected }) => {
    expect(deriveSettlement(input)).toMatchObject(expected);
  });

  test('rejects impossible negative aggregates and refunds above receipts', () => {
    expect(() =>
      deriveSettlement({
        totalCents: 10_000,
        receivedCents: 2_000,
        creditedCents: 0,
        refundedCents: 2_001,
      }),
    ).toThrow(/remboursements/i);
    expect(() =>
      deriveSettlement({
        totalCents: 10_000,
        receivedCents: 0,
        creditedCents: -1,
        refundedCents: 0,
      }),
    ).toThrow(/positif ou nul/i);
  });

  test('a payment reversal restores the balance before that payment', () => {
    const totals = summarizePaymentMovements([
      { type: 'encaissement', amountCents: 4_000 },
      { type: 'remboursement', amountCents: 4_000 },
    ]);

    expect(totals).toEqual({ receivedCents: 4_000, refundedCents: 4_000 });
    expect(
      deriveSettlement({ totalCents: 10_000, creditedCents: 0, ...totals }),
    ).toMatchObject({ state: 'non_reglee', outstandingCents: 10_000 });
  });
});

describe('credit-note allocation', () => {
  test('uses outstanding receivable before creating customer credit', () => {
    expect(
      allocateCreditNote({
        invoiceTotalCents: 12_000,
        previouslyCreditedCents: 0,
        netReceivedCents: 8_000,
        requestedCreditCents: 6_000,
      }),
    ).toEqual({
      againstOutstandingCents: 4_000,
      againstCollectedCents: 2_000,
    });
  });

  test('never credits more than the remaining original invoice amount', () => {
    expect(() =>
      allocateCreditNote({
        invoiceTotalCents: 12_000,
        previouslyCreditedCents: 3_000,
        netReceivedCents: 0,
        requestedCreditCents: 9_001,
      }),
    ).toThrow(/montant restant/i);
  });
});
