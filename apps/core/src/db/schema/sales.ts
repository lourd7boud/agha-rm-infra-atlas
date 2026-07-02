// pg schema: sales — private-job clients, devis, bons de livraison & factures.
import {
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

// ── Commercial / Ventes — private-job customer master + sales documents ───────
// Distinct from tender.buyer (PUBLIC-procurement acheteurs): sales.client is the
// SEPARATE commercial customer master for private jobs — devis, bons de livraison
// and factures. Quote/invoice totals (HT, TVA, TTC) are computed in sales.domain
// and persisted alongside the parent; lines mirror the situations/avenants
// parent+lines pattern. Money as numeric(14,2), pct as numeric(5,2).
export const sales = pgSchema('sales');

// A commercial customer (private client), the natural upsert key being
// (company_id, name) so re-imports back-fill instead of duplicating.
export const clients = sales.table(
  'client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    name: text('name').notNull(),
    /** Identifiant Commun de l'Entreprise — Moroccan business id. */
    ice: text('ice'),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    status: text('status').notNull().default('actif'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One client per (company, name): the natural upsert key for re-imports.
    uniqueIndex('sales_client_company_name_uniq').on(table.companyId, table.name),
  ],
);

// Devis — a price quote to a client. status ∈ {brouillon,envoye,accepte,refuse,
// expire}, validated at the edge. Totals folded in sales.domain on create.
export const quotes = sales.table(
  'quote',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    reference: text('reference').notNull(),
    objet: text('objet'),
    status: text('status').notNull().default('brouillon'),
    quoteDate: date('quote_date', { mode: 'date' }).notNull(),
    validUntil: date('valid_until', { mode: 'date' }),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Reference is unique per company; lists scope by client.
    uniqueIndex('sales_quote_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_quote_client_id_idx').on(table.clientId),
  ],
);

// Quote line items — inserted with the parent quote (situations/avenants pattern).
export const quoteLines = sales.table(
  'quote_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the quote — deleting the parent cascades.
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [index('sales_quote_line_quote_id_idx').on(table.quoteId)],
);

// Bon de livraison — a delivery note, optionally born from a quote.
// status ∈ {brouillon,livre}, validated at the edge.
export const deliveryNotes = sales.table(
  'delivery_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    quoteId: uuid('quote_id').references(() => quotes.id),
    reference: text('reference').notNull(),
    deliveryDate: date('delivery_date', { mode: 'date' }).notNull(),
    status: text('status').notNull().default('brouillon'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_delivery_note_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_delivery_note_client_id_idx').on(table.clientId),
  ],
);

// Delivery line items — quantities only (no price); inserted with the parent.
export const deliveryLines = sales.table(
  'delivery_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the BL — deleting the parent cascades.
    deliveryNoteId: uuid('delivery_note_id')
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    orderIndex: integer('order_index').default(0),
  },
  (table) => [
    index('sales_delivery_line_delivery_note_id_idx').on(table.deliveryNoteId),
  ],
);

// Facture — an invoice to a client, optionally linked to a quote.
// status ∈ {brouillon,envoyee,payee,annulee}. Totals folded in sales.domain.
export const invoices = sales.table(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    quoteId: uuid('quote_id').references(() => quotes.id),
    reference: text('reference').notNull(),
    invoiceDate: date('invoice_date', { mode: 'date' }).notNull(),
    dueDate: date('due_date', { mode: 'date' }),
    status: text('status').notNull().default('brouillon'),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    paidAt: date('paid_at', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_invoice_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_invoice_client_id_idx').on(table.clientId),
  ],
);

// Invoice line items — inserted with the parent invoice.
export const invoiceLines = sales.table(
  'invoice_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the invoice — deleting the parent cascades.
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').default(0),
  },
  (table) => [index('sales_invoice_line_invoice_id_idx').on(table.invoiceId)],
);
