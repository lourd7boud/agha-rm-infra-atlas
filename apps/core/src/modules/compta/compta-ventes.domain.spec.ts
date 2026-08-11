import { describe, expect, test } from 'vitest';
import {
  buildCreditNotePosting,
  buildInvoiceIssuePosting,
  type SalesPostingAccounts,
} from './compta-ventes.domain';

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

describe('invoice issue accounting', () => {
  test('keeps invoiced TVA pending under the encaissement taxable event', () => {
    const result = buildInvoiceIssuePosting({
      reference: 'FAC-2026-000001',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'encaissement',
      totalHtCents: 100_000,
      tvaCents: 20_000,
      totalTtcCents: 120_000,
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines).toEqual([
      {
        accountCode: '3421',
        debitCents: 120_000,
        creditCents: 0,
        party: 'Client Atlas',
      },
      { accountCode: '71242', debitCents: 0, creditCents: 100_000 },
      { accountCode: '4455', debitCents: 0, creditCents: 20_000 },
    ]);
    expectBalanced(result.lines);
  });

  test('recognizes invoiced TVA as due under the debits taxable event', () => {
    const result = buildInvoiceIssuePosting({
      reference: 'FAC-2026-000002',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'debits',
      totalHtCents: 100_000,
      tvaCents: 20_000,
      totalTtcCents: 120_000,
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines.at(-1)).toEqual({
      accountCode: '4456',
      debitCents: 0,
      creditCents: 20_000,
    });
    expectBalanced(result.lines);
  });

  test('blocks safely when the taxable event or a required account is missing', () => {
    expect(
      buildInvoiceIssuePosting({
        reference: 'FAC-2026-000003',
        clientName: 'Client Atlas',
        faitGenerateurTva: 'non_configure',
        totalHtCents: 100_000,
        tvaCents: 20_000,
        totalTtcCents: 120_000,
        accounts,
      }),
    ).toMatchObject({
      kind: 'blocked',
      code: 'fait_generateur_tva_non_configure',
    });

    expect(
      buildInvoiceIssuePosting({
        reference: 'FAC-2026-000004',
        clientName: 'Client Atlas',
        faitGenerateurTva: 'debits',
        totalHtCents: 100_000,
        tvaCents: 20_000,
        totalTtcCents: 120_000,
        accounts: { ...accounts, revenue: null },
      }),
    ).toMatchObject({ kind: 'blocked', code: 'compte_manquant' });
  });

  test('rejects an inconsistent immutable invoice snapshot', () => {
    expect(() =>
      buildInvoiceIssuePosting({
        reference: 'FAC-2026-000005',
        clientName: 'Client Atlas',
        faitGenerateurTva: 'debits',
        totalHtCents: 100_000,
        tvaCents: 20_000,
        totalTtcCents: 119_999,
        accounts,
      }),
    ).toThrow(/HT.*TVA.*TTC/i);
  });
});

describe('credit-note accounting', () => {
  test('reverses pending and due TVA according to unpaid/collected allocation', () => {
    const result = buildCreditNotePosting({
      reference: 'AV-2026-000001',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'encaissement',
      totalHtCents: 50_000,
      tvaCents: 10_000,
      totalTtcCents: 60_000,
      againstOutstandingCents: 40_000,
      againstCollectedCents: 20_000,
      outstandingBeforeCreditCents: 40_000,
      availablePendingTvaCents: 6_667,
      availableDueTvaCents: 13_333,
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines).toEqual([
      { accountCode: '71242', debitCents: 50_000, creditCents: 0 },
      { accountCode: '4455', debitCents: 6_667, creditCents: 0 },
      { accountCode: '4456', debitCents: 3_333, creditCents: 0 },
      {
        accountCode: '3421',
        debitCents: 0,
        creditCents: 60_000,
        party: 'Client Atlas',
      },
    ]);
    expectBalanced(result.lines);
  });

  test('reverses all TVA due for a debit-regime credit note', () => {
    const result = buildCreditNotePosting({
      reference: 'AV-2026-000002',
      clientName: 'Client Atlas',
      faitGenerateurTva: 'debits',
      totalHtCents: 50_000,
      tvaCents: 10_000,
      totalTtcCents: 60_000,
      againstOutstandingCents: 60_000,
      againstCollectedCents: 0,
      outstandingBeforeCreditCents: 60_000,
      availablePendingTvaCents: 0,
      availableDueTvaCents: 20_000,
      accounts,
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.lines).toContainEqual({
      accountCode: '4456',
      debitCents: 10_000,
      creditCents: 0,
    });
    expect(result.lines).not.toContainEqual(
      expect.objectContaining({ accountCode: '4455' }),
    );
    expectBalanced(result.lines);
  });

  test('rejects a TVA reversal above the actual pending/due tax position', () => {
    expect(() =>
      buildCreditNotePosting({
        reference: 'AV-2026-000003',
        clientName: 'Client Atlas',
        faitGenerateurTva: 'encaissement',
        totalHtCents: 50_000,
        tvaCents: 10_000,
        totalTtcCents: 60_000,
        againstOutstandingCents: 40_000,
        againstCollectedCents: 20_000,
        outstandingBeforeCreditCents: 40_000,
        availablePendingTvaCents: 6_000,
        availableDueTvaCents: 3_999,
        accounts,
      }),
    ).toThrow(/position TVA/i);
  });

  test('never spills unavailable pending TVA into the due TVA bucket', () => {
    expect(() =>
      buildCreditNotePosting({
        reference: 'AV-2026-000004',
        clientName: 'Client Atlas',
        faitGenerateurTva: 'encaissement',
        totalHtCents: 5_000,
        tvaCents: 1_000,
        totalTtcCents: 6_000,
        againstOutstandingCents: 6_000,
        againstCollectedCents: 0,
        outstandingBeforeCreditCents: 12_000,
        availablePendingTvaCents: 500,
        availableDueTvaCents: 500,
        accounts,
      }),
    ).toThrow(/position TVA/i);
  });
});
