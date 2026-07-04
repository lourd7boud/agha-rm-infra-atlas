import { beforeEach, describe, expect, test } from 'vitest';
import { InMemorySalesRepository } from './sales.repository';
import type { CreateInvoice, CreateQuote } from './sales.types';

const QUOTE_DATE = new Date('2026-06-21T00:00:00Z');

function quoteInput(partial: Partial<CreateQuote> = {}): CreateQuote {
  return {
    clientId: partial.clientId ?? 'client-1',
    reference: partial.reference ?? 'DV-2026-001',
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
    reference: partial.reference ?? 'FA-2026-001',
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
    await repo.createQuote(quoteInput({ clientId: 'A', reference: 'Q-A1' }));
    const qB = await repo.createQuote(
      quoteInput({ clientId: 'B', reference: 'Q-B1' }),
    );
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
    await repo.createQuote(quoteInput({ reference: 'Q-1' }));
    await repo.createQuote(quoteInput({ reference: 'Q-2' }));
    await repo.createQuote(quoteInput({ reference: 'Q-3' }));

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
      reference: 'BL-2026-001',
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
      reference: 'BL-2026-002',
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
      reference: 'BL-1',
      deliveryDate: QUOTE_DATE,
      lines: [
        { designation: 'Sacs ciment', quantity: 200, unit: 'sac' },
        { designation: 'Gravier', quantity: 5, unit: 't' },
      ],
    });
    await repo.createDeliveryNote({
      clientId: 'client-1',
      reference: 'BL-2',
      deliveryDate: QUOTE_DATE,
      lines: [{ designation: 'Sable', quantity: 3, unit: 't' }],
    });
    await repo.createDeliveryNote({
      clientId: 'client-1',
      reference: 'BL-3',
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
    const bl1 = all.find((note) => note.reference === 'BL-1');
    expect(bl1?.lineCount).toBe(2);
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
    await repo.createInvoice(invoiceInput({ reference: 'FA-1' }));
    const paid = await repo.createInvoice(invoiceInput({ reference: 'FA-2' }));
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
    await repo.createInvoice(invoiceInput({ reference: 'FA-A' }));
    await repo.createInvoice(invoiceInput({ reference: 'FA-B' }));
    const paid = await repo.createInvoice(invoiceInput({ reference: 'FA-C' }));
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
