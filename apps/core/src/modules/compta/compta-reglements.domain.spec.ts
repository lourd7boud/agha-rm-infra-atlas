import { describe, expect, test } from 'vitest';
import {
  buildPaymentReversalPosting,
  buildReceiptPosting,
  buildRefundPosting,
} from './compta-reglements.domain';
import type { SalesPostingAccounts } from './compta-ventes.domain';

const accounts: SalesPostingAccounts = {
  client: '3421',
  revenue: '71242',
  tvaPending: '4455',
  tvaDue: '4456',
};

function expectBalanced(lines: readonly { debitCents: number; creditCents: number }[]) {
  expect(lines.reduce((sum, line) => sum + line.debitCents, 0)).toBe(
    lines.reduce((sum, line) => sum + line.creditCents, 0),
  );
}

describe('receipt accounting', () => {
  test('posts treasury/client and transfers proportional TVA under encaissement', () => {
    const result = buildReceiptPosting({
      invoiceReference: 'FAC-2026-000001',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'encaissement',
      amountCents: 60_000,
      invoiceTtcCents: 120_000,
      invoiceTvaCents: 20_000,
      previouslyReceivedCents: 0,
      previouslyTransferredTvaCents: 0,
      treasuryAccount: '5141',
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines).toEqual([
      { accountCode: '5141', debitCents: 60_000, creditCents: 0 },
      {
        accountCode: '3421',
        debitCents: 0,
        creditCents: 60_000,
        party: 'Client Atlas',
      },
      { accountCode: '4455', debitCents: 10_000, creditCents: 0 },
      { accountCode: '4456', debitCents: 0, creditCents: 10_000 },
    ]);
    expectBalanced(result.lines);
  });

  test('assigns the final residual TVA centime to the last receipt', () => {
    const result = buildReceiptPosting({
      invoiceReference: 'FAC-2026-000002',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'encaissement',
      amountCents: 3_335,
      invoiceTtcCents: 10_001,
      invoiceTvaCents: 1_667,
      previouslyReceivedCents: 6_666,
      previouslyTransferredTvaCents: 1_111,
      treasuryAccount: '5141',
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.tvaTransferredCents).toBe(556);
    expect(result.lines).toContainEqual({
      accountCode: '4455',
      debitCents: 556,
      creditCents: 0,
    });
    expectBalanced(result.lines);
  });

  test.each([0, 10000])('does not transfer TVA again under debits with prior hypothetical transfer %i', (priorTransfer) => {
    const result = buildReceiptPosting({
      invoiceReference: 'FAC-2026-000003',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'debits',
      amountCents: 60_000,
      invoiceTtcCents: 120_000,
      invoiceTvaCents: 20_000,
      previouslyReceivedCents: priorTransfer > 0 ? 60000 : 0,
      previouslyTransferredTvaCents: priorTransfer,
      treasuryAccount: '5141',
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.tvaTransferredCents).toBe(0);
    expect(result.lines).toHaveLength(2);
    expectBalanced(result.lines);
  });

  test('blocks safely when TVA or treasury configuration is missing', () => {
    const common = {
      invoiceReference: 'FAC-2026-000004',
      clientName: 'Client Atlas',
      amountCents: 60_000,
      invoiceTtcCents: 120_000,
      invoiceTvaCents: 20_000,
      previouslyReceivedCents: 0,
      previouslyTransferredTvaCents: 0,
      accounts,
    } as const;

    expect(
      buildReceiptPosting({
        ...common,
        faitGenerateurTva: 'non_configure',
        treasuryAccount: '5141',
      }),
    ).toMatchObject({
      kind: 'blocked',
      code: 'fait_generateur_tva_non_configure',
    });
    expect(
      buildReceiptPosting({
        ...common,
        faitGenerateurTva: 'debits',
        treasuryAccount: null,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'compte_manquant' });
  });
});

describe('receipt correction and customer refund', () => {
  test('reverses the exact original receipt posting as a distinct entry', () => {
    const receipt = buildReceiptPosting({
      invoiceReference: 'FAC-2026-000005',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'encaissement',
      amountCents: 60_000,
      invoiceTtcCents: 120_000,
      invoiceTvaCents: 20_000,
      previouslyReceivedCents: 0,
      previouslyTransferredTvaCents: 0,
      treasuryAccount: '5141',
      accounts,
    });
    expect(receipt.kind).toBe('ready');
    if (receipt.kind !== 'ready') return;

    const reversal = buildPaymentReversalPosting({
      invoiceReference: 'FAC-2026-000005',
      originalLines: receipt.lines,
    });

    expect(reversal.kind).toBe('ready');
    if (reversal.kind !== 'ready') return;
    expect(reversal.lines).toEqual(
      receipt.lines.map((line) => ({
        ...line,
        debitCents: line.creditCents,
        creditCents: line.debitCents,
      })),
    );
    expectBalanced(reversal.lines);
  });

  test('clears a customer credit through treasury without a second TVA reversal', () => {
    const result = buildRefundPosting({
      invoiceReference: 'FAC-2026-000006',
      clientName: 'Client Atlas',
      amountCents: 20_000,
      treasuryAccount: '5141',
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines).toEqual([
      {
        accountCode: '3421',
        debitCents: 20_000,
        creditCents: 0,
        party: 'Client Atlas',
      },
      { accountCode: '5141', debitCents: 0, creditCents: 20_000 },
    ]);
    expectBalanced(result.lines);
  });
});
