import { beforeEach, describe, expect, test } from 'vitest';
import { InMemorySalesRepository } from './sales.repository';
import type { CreateInvoice, CreateQuote } from './sales.types';

const QUOTE_DATE = new Date('2026-06-21T00:00:00Z');

function quoteInput(partial: Partial<CreateQuote> = {}): CreateQuote {
  return {
    clientId: partial.clientId ?? 'client-1',
    quoteDate: partial.quoteDate ?? QUOTE_DATE,
    tvaPct: partial.tvaPct ?? 20,
    lines: partial.lines ?? [
      { designation: 'Béton C25', quantity: 10, unitPriceMad: 1200 },
    ],
    ...partial,
  };
}

function invoiceInput(partial: Partial<CreateInvoice> = {}): CreateInvoice {
  return {
    clientId: partial.clientId ?? 'client-1',
    invoiceDate: partial.invoiceDate ?? QUOTE_DATE,
    tvaPct: partial.tvaPct ?? 20,
    lines: partial.lines ?? [
      { designation: 'Main d’œuvre', quantity: 5, unitPriceMad: 800 },
    ],
    ...partial,
  };
}

describe('InMemorySalesRepository — clients', () => {
  let repo: InMemorySalesRepository;
  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  test('upsertClient inserts a new client as actif', async () => {
    // Arrange
    const input = { name: 'AGHID CONSTRUCTION', ice: '0001234567000089' };

    // Act
    const client = await repo.upsertClient(input);

    // Assert
    expect(client.id).toBeTruthy();
    expect(client.name).toBe('AGHID CONSTRUCTION');
    expect(client.status).toBe('actif');
  });

  test('upsertClient on the same name back-fills without duplicating', async () => {
    // Arrange
    const first = await repo.upsertClient({ name: 'OCP SA' });

    // Act
    const second = await repo.upsertClient({ name: 'OCP SA', phone: '0522000000' });
    const all = await repo.listClients({ limit: 25, offset: 0 });

    // Assert
    expect(second.id).toBe(first.id);
    expect(second.phone).toBe('0522000000');
    expect(all.total).toBe(1);
    expect(all.items).toHaveLength(1);
  });

  test('listClients paginates and clientsSummary counts the whole set', async () => {
    // Arrange — three clients; the third landing inactif via a status field is
    // out of scope (upsert defaults to actif), so all three are actif here.
    await repo.upsertClient({ name: 'Client A' });
    await repo.upsertClient({ name: 'Client B' });
    await repo.upsertClient({ name: 'Client C' });

    // Act — a page window of 2, then the DB-side summary over all three.
    const firstPage = await repo.listClients({ limit: 2, offset: 0 });
    const secondPage = await repo.listClients({ limit: 2, offset: 2 });
    const summary = await repo.clientsSummary();

    // Assert
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(summary.count).toBe(3);
    expect(summary.activeCount).toBe(3);
  });

  test('getClient returns null for an unknown id', async () => {
    // Arrange + Act
    const found = await repo.getClient('missing');

    // Assert
    expect(found).toBeNull();
  });
});

describe('InMemorySalesRepository — quotes', () => {
  let repo: InMemorySalesRepository;
  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  test('createQuote folds line totals into HT/TTC and stores lines', async () => {
    // Arrange
    const input = quoteInput({
      lines: [
        { designation: 'Béton', quantity: 10, unitPriceMad: 1200 },
        { designation: 'Acier', quantity: 2, unitPriceMad: 9000 },
      ],
    });

    // Act
    const quote = await repo.createQuote(input);

    // Assert
    expect(quote.status).toBe('brouillon');
    expect(quote.totalHtMad).toBe(30000);
    expect(quote.totalTtcMad).toBe(36000);
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines[0]?.lineTotalMad).toBe(12000);
  });

  test('setQuoteStatus transitions a stored quote', async () => {
    // Arrange
    const created = await repo.createQuote(quoteInput());

    // Act
    const updated = await repo.setQuoteStatus(created.id, 'accepte');

    // Assert
    expect(updated?.status).toBe('accepte');
  });

  test('listQuotes filters by clientId and status', async () => {
    // Arrange
    await repo.createQuote(quoteInput({ clientId: 'A' }));
    const qB = await repo.createQuote(quoteInput({ clientId: 'B' }));
    await repo.setQuoteStatus(qB.id, 'envoye');

    // Act
    const byClient = await repo.listQuotes({ clientId: 'B' }, { limit: 25, offset: 0 });
    const byStatus = await repo.listQuotes({ status: 'envoye' }, { limit: 25, offset: 0 });

    // Assert
    expect(byClient.total).toBe(1);
    expect(byClient.items[0]?.clientId).toBe('B');
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]?.id).toBe(qB.id);
  });

  test('listQuotes projects out lines and paginates; quotesSummary totals the set', async () => {
    // Arrange — three quotes (each TTC 36000 at 20% TVA over a 30000 HT line).
    await repo.createQuote(quoteInput());
    await repo.createQuote(quoteInput());
    await repo.createQuote(quoteInput());

    // Act — a page window of 2, then the DB-side summary over all three.
    const firstPage = await repo.listQuotes({}, { limit: 2, offset: 0 });
    const secondPage = await repo.listQuotes({}, { limit: 2, offset: 2 });
    const summary = await repo.quotesSummary({});

    // Assert — items carry no lines; total spans the set; summary sums TTC.
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(firstPage.items[0]).not.toHaveProperty('lines');
    expect(summary.count).toBe(3);
    expect(summary.totalTtcMad).toBeGreaterThan(0);
  });
});

describe('InMemorySalesRepository — delivery notes', () => {
  let repo: InMemorySalesRepository;
  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  test('createDeliveryNote stores its lines as brouillon', async () => {
    // Arrange + Act
    const note = await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Sacs ciment', quantity: 200, unit: 'sac' }],
    });

    // Assert
    expect(note.status).toBe('brouillon');
    expect(note.lines).toHaveLength(1);
    expect(note.lines[0]?.quantity).toBe(200);
  });

  test('setDeliveryNoteStatus transitions brouillon → livre', async () => {
    // Arrange
    const created = await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Gravier', quantity: 5, unit: 't' }],
    });

    // Act
    const updated = await repo.setDeliveryNoteStatus(created.id, 'livre');

    // Assert
    expect(updated?.status).toBe('livre');
  });

  test('setDeliveryNoteStatus returns null for an unknown id', async () => {
    // Arrange + Act
    const updated = await repo.setDeliveryNoteStatus('missing', 'livre');

    // Assert
    expect(updated).toBeNull();
  });

  test('listDeliveryNotes paginates and projects lineCount instead of lines', async () => {
    // Arrange — three notes; the first carries two lines, the rest one each.
    await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [
        { designation: 'Sacs ciment', quantity: 200, unit: 'sac' },
        { designation: 'Gravier', quantity: 5, unit: 't' },
      ],
    });
    await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Sable', quantity: 3, unit: 't' }],
    });
    await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Acier', quantity: 1, unit: 't' }],
    });

    // Act — a page window of 2, then the rest.
    const firstPage = await repo.listDeliveryNotes({}, { limit: 2, offset: 0 });
    const secondPage = await repo.listDeliveryNotes({}, { limit: 2, offset: 2 });

    // Assert — items carry a lineCount, never a lines array.
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(firstPage.items[0]).not.toHaveProperty('lines');
    // The BL-1 note (two lines) surfaces with lineCount 2 regardless of paging.
    const all = [...firstPage.items, ...secondPage.items];
    expect(all.some((note) => note.lineCount === 2)).toBe(true);
  });
});

describe('InMemorySalesRepository — invoices', () => {
  let repo: InMemorySalesRepository;
  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  test('createInvoice folds totals with 0% TVA (HT == TTC)', async () => {
    // Arrange
    const input = invoiceInput({
      tvaPct: 0,
      lines: [{ designation: 'Étude', quantity: 1, unitPriceMad: 15000 }],
    });

    // Act
    const invoice = await repo.createInvoice(input);

    // Assert
    expect(invoice.totalHtMad).toBe(15000);
    expect(invoice.totalTtcMad).toBe(15000);
  });

  test('setInvoiceStatus to payee stamps paidAt', async () => {
    // Arrange
    const created = await repo.createInvoice(invoiceInput());
    const paidAt = new Date('2026-07-01T00:00:00Z');

    // Act
    const updated = await repo.setInvoiceStatus(created.id, 'payee', paidAt);

    // Assert
    expect(updated?.status).toBe('payee');
    expect(updated?.paidAt).toEqual(paidAt);
  });

  test('listInvoices filters by status', async () => {
    // Arrange
    await repo.createInvoice(invoiceInput());
    const paid = await repo.createInvoice(invoiceInput());
    await repo.setInvoiceStatus(paid.id, 'payee');

    // Act
    const payees = await repo.listInvoices(
      { status: 'payee' },
      { limit: 25, offset: 0 },
    );

    // Assert
    expect(payees.total).toBe(1);
    expect(payees.items).toHaveLength(1);
    expect(payees.items[0]?.id).toBe(paid.id);
  });

  test('listInvoices paginates and invoicesSummary totals the whole set', async () => {
    // Arrange — three invoices; one paid so it drops out of "outstanding".
    await repo.createInvoice(invoiceInput());
    await repo.createInvoice(invoiceInput());
    const paid = await repo.createInvoice(invoiceInput());
    await repo.setInvoiceStatus(paid.id, 'payee');

    // Act — page window of 2, then the DB-side summary over all three.
    const firstPage = await repo.listInvoices({}, { limit: 2, offset: 0 });
    const secondPage = await repo.listInvoices({}, { limit: 2, offset: 2 });
    const summary = await repo.invoicesSummary({});

    // Assert — total counts every match; each page is bounded; summary spans all.
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(summary.count).toBe(3);
    expect(summary.totalTtcMad).toBeGreaterThan(summary.outstandingTtcMad);
  });
});

describe('InMemorySalesRepository — legal sequential numbering (art. 145)', () => {
  let repo: InMemorySalesRepository;
  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  const legalSnapshot = {
    legalName: 'AGHA RM INFRA SARL',
    address: 'Errachidia',
    ice: '001234567890123',
    taxId: '12345678',
    tradeRegister: 'RC-1234',
  };

  test('issuing drafts mints FAC-{year}-NNNNNN sequentially', async () => {
    const firstDraft = await repo.createInvoice(invoiceInput());
    const secondDraft = await repo.createInvoice(invoiceInput());
    const first = await repo.issueInvoice(
      firstDraft.id,
      'direction-1',
      QUOTE_DATE,
      legalSnapshot,
    );
    const second = await repo.issueInvoice(
      secondDraft.id,
      'direction-1',
      QUOTE_DATE,
      legalSnapshot,
    );

    expect(first.reference).toBe('FAC-2026-000001');
    expect(second.reference).toBe('FAC-2026-000002');
  });

  test('the counter resets per exercice (fiscal year)', async () => {
    // Arrange + Act — one invoice in 2026, one in 2025.
    const y2026Draft = await repo.createInvoice(
      invoiceInput({ invoiceDate: new Date('2026-03-01T00:00:00Z') }),
    );
    const y2025Draft = await repo.createInvoice(
      invoiceInput({ invoiceDate: new Date('2025-11-01T00:00:00Z') }),
    );
    const y2026 = await repo.issueInvoice(
      y2026Draft.id,
      'direction-1',
      new Date('2026-03-01T00:00:00Z'),
      legalSnapshot,
    );
    const y2025 = await repo.issueInvoice(
      y2025Draft.id,
      'direction-1',
      new Date('2025-11-01T00:00:00Z'),
      legalSnapshot,
    );

    // Assert — each year starts at 0001.
    expect(y2026.reference).toBe('FAC-2026-000001');
    expect(y2025.reference).toBe('FAC-2025-000001');
  });

  test('each document kind owns an independent sequence', async () => {
    // Act — first document of each kind in the same year.
    const invoiceDraft = await repo.createInvoice(invoiceInput());
    const quoteDraft = await repo.createQuote(quoteInput());
    const blDraft = await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Sable', quantity: 3, unit: 't' }],
    });

    const invoice = await repo.issueInvoice(
      invoiceDraft.id,
      'direction-1',
      QUOTE_DATE,
      legalSnapshot,
    );
    const quote = await repo.issueQuote(quoteDraft.id, 'direction-1', QUOTE_DATE);
    const bl = await repo.issueDeliveryNote(blDraft.id, 'direction-1', QUOTE_DATE);

    expect(invoice.reference).toBe('FAC-2026-000001');
    expect(quote.reference).toBe('DEV-2026-000001');
    expect(bl.reference).toBe('BL-2026-000001');
  });

  test('draft creation never allocates an official reference', async () => {
    const invoice = await repo.createInvoice(invoiceInput());
    expect(invoice.reference).toBeNull();
  });
});

describe('InMemorySalesRepository — issue-time lifecycle', () => {
  let repo: InMemorySalesRepository;

  beforeEach(() => {
    repo = new InMemorySalesRepository();
  });

  test('drafts consume no official reference and issue idempotently by kind', async () => {
    const quote = await repo.createQuote(quoteInput());
    const delivery = await repo.createDeliveryNote({
      clientId: 'client-1',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Sable', quantity: 3, unit: 't' }],
    });
    const invoice = await repo.createInvoice(invoiceInput());

    expect([quote.reference, delivery.reference, invoice.reference]).toEqual([
      null,
      null,
      null,
    ]);

    const issuedQuote = await repo.issueQuote(quote.id, 'direction-1', QUOTE_DATE);
    const issuedQuoteAgain = await repo.issueQuote(
      quote.id,
      'direction-1',
      QUOTE_DATE,
    );
    const issuedDelivery = await repo.issueDeliveryNote(
      delivery.id,
      'direction-1',
      QUOTE_DATE,
    );
    const issuedInvoice = await repo.issueInvoice(
      invoice.id,
      'direction-1',
      QUOTE_DATE,
      {
        legalName: 'AGHA RM INFRA SARL',
        address: 'Errachidia',
        ice: '001234567890123',
        taxId: '12345678',
        tradeRegister: 'RC-1234',
      },
    );

    expect(issuedQuote.reference).toBe('DEV-2026-000001');
    expect(issuedQuoteAgain.reference).toBe(issuedQuote.reference);
    expect(issuedDelivery.reference).toBe('BL-2026-000001');
    expect(issuedInvoice.reference).toBe('FAC-2026-000001');
    expect(issuedInvoice.status).toBe('emise');
  });

  test('concurrent invoice issue cannot allocate duplicate references', async () => {
    const first = await repo.createInvoice(invoiceInput());
    const second = await repo.createInvoice(invoiceInput());
    const legalSnapshot = {
      legalName: 'AGHA RM INFRA SARL',
      address: 'Errachidia',
      ice: '001234567890123',
      taxId: '12345678',
      tradeRegister: 'RC-1234',
    };

    const issued = await Promise.all([
      repo.issueInvoice(first.id, 'direction-1', QUOTE_DATE, legalSnapshot),
      repo.issueInvoice(second.id, 'direction-1', QUOTE_DATE, legalSnapshot),
    ]);

    expect(new Set(issued.map((item) => item.reference)).size).toBe(2);
    expect(issued.map((item) => item.reference).sort()).toEqual([
      'FAC-2026-000001',
      'FAC-2026-000002',
    ]);
  });

  test('issued invoices reject edits and deletion', async () => {
    const invoice = await repo.createInvoice(invoiceInput());
    await repo.issueInvoice(invoice.id, 'direction-1', QUOTE_DATE, {
      legalName: 'AGHA RM INFRA SARL',
      address: 'Errachidia',
      ice: '001234567890123',
      taxId: '12345678',
      tradeRegister: 'RC-1234',
    });

    await expect(
      repo.updateDraftInvoice(invoice.id, { notes: 'Mutation interdite', version: 1 }),
    ).rejects.toThrow(/émise|brouillon/i);
    await expect(repo.deleteDraftInvoice(invoice.id)).rejects.toThrow(
      /émise|brouillon/i,
    );
  });

  test('records and reverses payment movements without mutating history', async () => {
    const draft = await repo.createInvoice(invoiceInput());
    const invoice = await repo.issueInvoice(
      draft.id,
      'direction-1',
      QUOTE_DATE,
      {
        legalName: 'AGHA RM INFRA SARL',
        address: 'Errachidia',
        ice: '001234567890123',
        taxId: '12345678',
        tradeRegister: 'RC-1234',
      },
    );
    const paid = await repo.recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_000,
      method: 'virement',
      treasuryAccount: '5141',
      valueDate: QUOTE_DATE,
      idempotencyKey: 'payment-1',
      actor: 'comptable-1',
    });

    expect(paid.payments).toHaveLength(1);
    expect(paid.settlement.outstandingCents).toBe(380_000);

    const reversed = await repo.reversePayment({
      invoiceId: invoice.id,
      paymentId: paid.payments[0]!.id,
      valueDate: QUOTE_DATE,
      idempotencyKey: 'reversal-1',
      actor: 'comptable-1',
    });
    expect(reversed.payments).toHaveLength(2);
    expect(reversed.settlement.state).toBe('non_reglee');
  });

  test('issues a credit note with its own AV sequence', async () => {
    const draft = await repo.createInvoice(invoiceInput());
    const invoice = await repo.issueInvoice(
      draft.id,
      'direction-1',
      QUOTE_DATE,
      {
        legalName: 'AGHA RM INFRA SARL',
        address: 'Errachidia',
        ice: '001234567890123',
        taxId: '12345678',
        tradeRegister: 'RC-1234',
      },
    );
    const creditDraft = await repo.createCreditNote({
      invoiceId: invoice.id,
      creditDate: QUOTE_DATE,
      totalHtCents: 100_000,
      tvaCents: 20_000,
      reason: 'Correction commerciale',
      createdBy: 'direction-1',
    });
    const credit = await repo.issueCreditNote(
      creditDraft.id,
      'direction-1',
      QUOTE_DATE,
    );

    expect(credit.reference).toBe('AV-2026-000001');
    expect(credit.againstOutstandingCents).toBe(120_000);
    expect(credit.againstCollectedCents).toBe(0);
  });
});
