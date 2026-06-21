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
    const all = await repo.listClients();

    // Assert
    expect(second.id).toBe(first.id);
    expect(second.phone).toBe('0522000000');
    expect(all).toHaveLength(1);
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
    const byClient = await repo.listQuotes({ clientId: 'B' });
    const byStatus = await repo.listQuotes({ status: 'envoye' });

    // Assert
    expect(byClient).toHaveLength(1);
    expect(byClient[0]?.clientId).toBe('B');
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0]?.id).toBe(qB.id);
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
    const payees = await repo.listInvoices({ status: 'payee' });

    // Assert
    expect(payees).toHaveLength(1);
    expect(payees[0]?.id).toBe(paid.id);
  });
});
