import { describe, expect, test } from 'vitest';
import {
  clients,
  docSequences,
  invoiceLines,
  invoices,
  salesAccountingEvents,
} from '../../db/schema';
import type { Db } from '../../db/client';
import { DrizzleSalesRepository } from './sales.drizzle.repository';

const DATE = new Date('2026-06-21T00:00:00Z');
const BASE_INVOICE = {
  id: 'invoice-1',
  companyId: 'agha-rm-infra',
  clientId: 'client-1',
  projectId: null,
  quoteId: null,
  reference: null,
  legacyReference: null,
  invoiceDate: DATE,
  dueDate: null,
  status: 'brouillon',
  totalHtMad: '100.00',
  tvaPct: '20.00',
  tvaMad: '20.00',
  totalTtcMad: '120.00',
  paidAt: null,
  legacyPaid: false,
  paymentTerms: null,
  plannedPaymentMethod: null,
  currency: 'MAD',
  notes: null,
  issuedAt: null,
  issuedBy: null,
  issueIdempotencyKey: null,
  legalSnapshot: null,
  contentHash: null,
  version: 1,
  createdAt: DATE,
};

function createFakeDb(mode: 'create' | 'issue') {
  const inserted: unknown[] = [];
  let transactionCount = 0;
  const issuedInvoice = {
    ...BASE_INVOICE,
    reference: 'FAC-2026-000001',
    status: 'emise',
    issuedAt: DATE,
    issuedBy: 'direction-1',
    legalSnapshot: {},
    contentHash: 'hash',
    version: 2,
  };

  const returningBuilder = (rows: unknown[]) => ({
    values() {
      return this;
    },
    set() {
      return this;
    },
    where() {
      return this;
    },
    onConflictDoUpdate() {
      return this;
    },
    onConflictDoNothing() {
      return Promise.resolve();
    },
    returning() {
      return Promise.resolve(rows);
    },
  });

  const tx = {
    execute: () => Promise.resolve(),
    select: () => ({
      from(table: unknown) {
        return {
          where() {
            return {
              limit: () =>
                Promise.resolve(
                  table === invoices
                    ? [BASE_INVOICE]
                    : table === clients
                      ? [{ name: 'Client BTP' }]
                      : [],
                ),
              orderBy: () => Promise.resolve([]),
            };
          },
        };
      },
    }),
    insert(table: unknown) {
      inserted.push(table);
      if (table === invoices) return returningBuilder([BASE_INVOICE]);
      if (table === invoiceLines) return returningBuilder([]);
      if (table === docSequences) return returningBuilder([{ lastValue: 1 }]);
      if (table === salesAccountingEvents) return returningBuilder([]);
      return returningBuilder([]);
    },
    update(table: unknown) {
      return returningBuilder(table === invoices ? [issuedInvoice] : []);
    },
  };

  const db = {
    transaction: async (callback: (value: typeof tx) => unknown) => {
      transactionCount += 1;
      return callback(tx);
    },
  } as unknown as Db;

  return {
    db,
    inserted,
    transactionCount: () => transactionCount,
    mode,
  };
}

describe('DrizzleSalesRepository issue lifecycle', () => {
  test('creates an unnumbered draft without touching the official sequence', async () => {
    const fake = createFakeDb('create');
    const repository = new DrizzleSalesRepository(fake.db);

    const draft = await repository.createInvoice({
      clientId: 'client-1',
      invoiceDate: DATE,
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 100 }],
    });

    expect(draft.reference).toBeNull();
    expect(fake.inserted).not.toContain(docSequences);
    expect(fake.transactionCount()).toBe(1);
  });

  test('allocates and persists an official number inside one transaction', async () => {
    const fake = createFakeDb('issue');
    const repository = new DrizzleSalesRepository(fake.db);

    const issued = await repository.issueInvoice(
      'invoice-1',
      'direction-1',
      DATE,
      {
        legalName: 'AGHA RM INFRA SARL',
        address: 'Errachidia',
        ice: '001234567890123',
        taxId: '12345678',
        tradeRegister: 'RC-1234',
      },
    );

    expect(issued.reference).toBe('FAC-2026-000001');
    expect(fake.inserted).toContain(docSequences);
    expect(fake.inserted).toContain(salesAccountingEvents);
    expect(fake.transactionCount()).toBe(1);
  });
});
