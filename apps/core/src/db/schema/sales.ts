// pg schema: sales — private-job clients, devis, bons de livraison & factures.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { comptes, ecritures } from './compta';
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
    clientType: text('client_type').notNull().default('professionnel'),
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
    check(
      'sales_client_type_chk',
      sql`${table.clientType} in ('professionnel', 'particulier')`,
    ),
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
    /** Official reference is allocated only when the draft is issued. */
    reference: text('reference'),
    legacyReference: text('legacy_reference'),
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
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: text('issued_by'),
    issueIdempotencyKey: text('issue_idempotency_key'),
    legalSnapshot: jsonb('legal_snapshot').$type<Record<string, unknown>>(),
    contentHash: text('content_hash'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Reference is unique per company; lists scope by client.
    uniqueIndex('sales_quote_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_quote_client_id_idx').on(table.clientId),
    // The devis board filters by status — keep that facet off a seq scan.
    index('sales_quote_status_idx').on(table.status),
    uniqueIndex('sales_quote_issue_idempotency_uniq')
      .on(table.companyId, table.issueIdempotencyKey)
      .where(sql`issue_idempotency_key is not null`),
    check(
      'sales_quote_issue_state_chk',
      sql`(${table.status} = 'brouillon' and ${table.reference} is null and ${table.issuedAt} is null and ${table.issuedBy} is null and ${table.legalSnapshot} is null and ${table.contentHash} is null)
        or (${table.status} <> 'brouillon' and ${table.reference} is not null and ${table.issuedAt} is not null and ${table.issuedBy} is not null and ${table.legalSnapshot} is not null and ${table.contentHash} is not null)`,
    ),
    check(
      'sales_quote_status_chk',
      sql`${table.status} in ('brouillon', 'envoye', 'accepte', 'refuse', 'expire')`,
    ),
    check('sales_quote_version_chk', sql`${table.version} > 0`),
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
    reference: text('reference'),
    legacyReference: text('legacy_reference'),
    deliveryDate: date('delivery_date', { mode: 'date' }).notNull(),
    status: text('status').notNull().default('brouillon'),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: text('issued_by'),
    issueIdempotencyKey: text('issue_idempotency_key'),
    legalSnapshot: jsonb('legal_snapshot').$type<Record<string, unknown>>(),
    contentHash: text('content_hash'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_delivery_note_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_delivery_note_client_id_idx').on(table.clientId),
    // The BL board filters by status — keep that facet off a seq scan.
    index('sales_delivery_note_status_idx').on(table.status),
    uniqueIndex('sales_delivery_note_issue_idempotency_uniq')
      .on(table.companyId, table.issueIdempotencyKey)
      .where(sql`issue_idempotency_key is not null`),
    check(
      'sales_delivery_note_issue_state_chk',
      sql`(${table.status} = 'brouillon' and ${table.reference} is null and ${table.issuedAt} is null and ${table.issuedBy} is null and ${table.legalSnapshot} is null and ${table.contentHash} is null)
        or (${table.status} <> 'brouillon' and ${table.reference} is not null and ${table.issuedAt} is not null and ${table.issuedBy} is not null and ${table.legalSnapshot} is not null and ${table.contentHash} is not null)`,
    ),
    check(
      'sales_delivery_note_status_chk',
      sql`${table.status} in ('brouillon', 'livre')`,
    ),
    check('sales_delivery_note_version_chk', sql`${table.version} > 0`),
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
    reference: text('reference'),
    legacyReference: text('legacy_reference'),
    invoiceDate: date('invoice_date', { mode: 'date' }).notNull(),
    dueDate: date('due_date', { mode: 'date' }),
    status: text('status').notNull().default('brouillon'),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    tvaMad: numeric('tva_mad', { precision: 14, scale: 2 }).notNull().default('0'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    paidAt: date('paid_at', { mode: 'date' }),
    /** Explicit compatibility marker for pre-ledger invoices known as paid. */
    legacyPaid: boolean('legacy_paid').notNull().default(false),
    paymentTerms: text('payment_terms'),
    plannedPaymentMethod: text('planned_payment_method'),
    currency: text('currency').notNull().default('MAD'),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: text('issued_by'),
    issueIdempotencyKey: text('issue_idempotency_key'),
    legalSnapshot: jsonb('legal_snapshot').$type<Record<string, unknown>>(),
    contentHash: text('content_hash'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_invoice_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_invoice_client_id_idx').on(table.clientId),
    // The facture board filters by status (impayées, en retard…) — keep that
    // facet off a seq scan.
    index('sales_invoice_status_idx').on(table.status),
    uniqueIndex('sales_invoice_issue_idempotency_uniq')
      .on(table.companyId, table.issueIdempotencyKey)
      .where(sql`issue_idempotency_key is not null`),
    check(
      'sales_invoice_status_chk',
      sql`${table.status} in ('brouillon', 'emise', 'annulee')`,
    ),
    check(
      'sales_invoice_issue_state_chk',
      sql`(${table.status} = 'brouillon' and ${table.reference} is null and ${table.issuedAt} is null and ${table.issuedBy} is null and ${table.legalSnapshot} is null and ${table.contentHash} is null)
        or (${table.status} <> 'brouillon' and ${table.reference} is not null and ${table.issuedAt} is not null and ${table.issuedBy} is not null and ${table.legalSnapshot} is not null and ${table.contentHash} is not null)`,
    ),
    check(
      'sales_invoice_totals_chk',
      sql`${table.totalHtMad} >= 0 and ${table.tvaMad} >= 0 and ${table.totalHtMad} + ${table.tvaMad} = ${table.totalTtcMad}`,
    ),
    check('sales_invoice_version_chk', sql`${table.version} > 0`),
    check('sales_invoice_currency_chk', sql`${table.currency} = 'MAD'`),
    check(
      'sales_invoice_legacy_paid_chk',
      sql`not ${table.legacyPaid} or ${table.paidAt} is not null`,
    ),
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

// Official numbering counter. The issuing transaction upserts and increments
// exactly one row for the company/document/fiscal-year scope.
export const docSequences = sales.table(
  'doc_sequence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull(),
    docType: text('doc_type').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    lastValue: integer('last_value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_doc_sequence_scope_uniq').on(
      table.companyId,
      table.docType,
      table.fiscalYear,
    ),
    check(
      'sales_doc_sequence_type_chk',
      sql`${table.docType} in ('DEV', 'BL', 'FAC', 'AV')`,
    ),
    check('sales_doc_sequence_year_chk', sql`${table.fiscalYear} between 2000 and 9999`),
    check('sales_doc_sequence_value_chk', sql`${table.lastValue} >= 0`),
  ],
);

// Append-only customer settlement ledger. Corrections are new remboursement
// rows linked to the original movement; records are never edited or deleted.
export const invoicePayments = sales.table(
  'invoice_payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    movementType: text('movement_type').notNull(),
    reason: text('reason').notNull().default('reglement_client'),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    treasuryAccount: text('treasury_account').notNull(),
    valueDate: date('value_date', { mode: 'date' }).notNull(),
    originalMovementId: uuid('original_movement_id'),
    creditNoteId: uuid('credit_note_id'),
    tvaTransferredMad: numeric('tva_transferred_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_invoice_payment_idempotency_uniq').on(
      table.invoiceId,
      table.idempotencyKey,
    ),
    index('sales_invoice_payment_invoice_date_idx').on(
      table.invoiceId,
      table.valueDate,
    ),
    uniqueIndex('sales_invoice_payment_reversal_uniq')
      .on(table.originalMovementId)
      .where(sql`original_movement_id is not null`),
    uniqueIndex('sales_invoice_payment_id_invoice_uniq').on(
      table.id,
      table.invoiceId,
    ),
    foreignKey({
      columns: [table.originalMovementId, table.invoiceId],
      foreignColumns: [table.id, table.invoiceId],
      name: 'sales_invoice_payment_original_fk',
    }),
    foreignKey({
      columns: [table.creditNoteId, table.invoiceId],
      foreignColumns: [creditNotes.id, creditNotes.invoiceId],
      name: 'sales_invoice_payment_credit_note_fk',
    }),
    foreignKey({
      columns: [table.treasuryAccount],
      foreignColumns: [comptes.code],
      name: 'sales_invoice_payment_treasury_account_fk',
    }),
    check(
      'sales_invoice_payment_type_chk',
      sql`${table.movementType} in ('encaissement', 'remboursement')`,
    ),
    check(
      'sales_invoice_payment_reason_chk',
      sql`${table.reason} in ('reglement_client', 'contrepassation', 'remboursement_avoir')`,
    ),
    check(
      'sales_invoice_payment_link_chk',
      sql`(${table.movementType} = 'encaissement' and ${table.reason} = 'reglement_client' and ${table.originalMovementId} is null and ${table.creditNoteId} is null)
        or (${table.movementType} = 'remboursement' and ${table.reason} = 'contrepassation' and ${table.originalMovementId} is not null and ${table.creditNoteId} is null and ${table.originalMovementId} <> ${table.id})
        or (${table.movementType} = 'remboursement' and ${table.reason} = 'remboursement_avoir' and ${table.originalMovementId} is null and ${table.creditNoteId} is not null)`,
    ),
    check('sales_invoice_payment_amount_chk', sql`${table.amountMad} > 0`),
    check(
      'sales_invoice_payment_tva_chk',
      sql`${table.tvaTransferredMad} >= 0 and ${table.tvaTransferredMad} <= ${table.amountMad}`,
    ),
  ],
);

export const creditNotes = sales.table(
  'credit_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    reference: text('reference'),
    legacyReference: text('legacy_reference'),
    status: text('status').notNull().default('brouillon'),
    creditDate: date('credit_date', { mode: 'date' }).notNull(),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 }).notNull(),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull(),
    tvaMad: numeric('tva_mad', { precision: 14, scale: 2 }).notNull(),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 }).notNull(),
    againstOutstandingMad: numeric('against_outstanding_mad', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    againstCollectedMad: numeric('against_collected_mad', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    reversedPendingTvaMad: numeric('reversed_pending_tva_mad', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    reversedDueTvaMad: numeric('reversed_due_tva_mad', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    reason: text('reason').notNull(),
    issueIdempotencyKey: text('issue_idempotency_key'),
    legalSnapshot: jsonb('legal_snapshot').$type<Record<string, unknown>>(),
    contentHash: text('content_hash'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: text('issued_by'),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_credit_note_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    uniqueIndex('sales_credit_note_issue_idempotency_uniq')
      .on(table.companyId, table.issueIdempotencyKey)
      .where(sql`issue_idempotency_key is not null`),
    index('sales_credit_note_invoice_idx').on(table.invoiceId),
    uniqueIndex('sales_credit_note_id_invoice_uniq').on(table.id, table.invoiceId),
    check(
      'sales_credit_note_status_chk',
      sql`${table.status} in ('brouillon', 'emise', 'annulee')`,
    ),
    check('sales_credit_note_amount_chk', sql`${table.totalTtcMad} > 0`),
    check(
      'sales_credit_note_components_chk',
      sql`${table.totalHtMad} >= 0 and ${table.tvaMad} >= 0 and ${table.againstOutstandingMad} >= 0 and ${table.againstCollectedMad} >= 0 and ${table.reversedPendingTvaMad} >= 0 and ${table.reversedDueTvaMad} >= 0`,
    ),
    check(
      'sales_credit_note_totals_chk',
      sql`${table.totalHtMad} + ${table.tvaMad} = ${table.totalTtcMad}`,
    ),
    check(
      'sales_credit_note_allocation_chk',
      sql`${table.status} = 'brouillon' or ${table.againstOutstandingMad} + ${table.againstCollectedMad} = ${table.totalTtcMad}`,
    ),
    check(
      'sales_credit_note_reversed_tva_chk',
      sql`${table.status} = 'brouillon' or ${table.reversedPendingTvaMad} + ${table.reversedDueTvaMad} = ${table.tvaMad}`,
    ),
    check(
      'sales_credit_note_issue_state_chk',
      sql`(${table.status} = 'brouillon' and ${table.reference} is null and ${table.issuedAt} is null and ${table.issuedBy} is null and ${table.legalSnapshot} is null and ${table.contentHash} is null)
        or (${table.status} <> 'brouillon' and ${table.reference} is not null and ${table.issuedAt} is not null and ${table.issuedBy} is not null and ${table.legalSnapshot} is not null and ${table.contentHash} is not null)`,
    ),
    check('sales_credit_note_version_chk', sql`${table.version} > 0`),
  ],
);

export const creditNoteLines = sales.table(
  'credit_note_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [
    index('sales_credit_note_line_credit_note_idx').on(table.creditNoteId),
    check(
      'sales_credit_note_line_amounts_chk',
      sql`${table.quantity} > 0 and ${table.unitPriceMad} >= 0 and ${table.tvaPct} >= 0 and ${table.lineTotalMad} >= 0`,
    ),
  ],
);

// Durable outbox/reconciliation item. Commercial transactions append an event;
// the accounting projector either links a draft entry or records a visible block.
export const salesAccountingEvents = sales.table(
  'accounting_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceVersion: integer('source_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    accountingEntryId: uuid('accounting_entry_id'),
    projectedAt: timestamp('projected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_accounting_event_company_key_uniq').on(
      table.companyId,
      table.eventKey,
    ),
    index('sales_accounting_event_status_date_idx').on(
      table.status,
      table.occurredAt,
    ),
    index('sales_accounting_event_source_idx').on(
      table.sourceType,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.accountingEntryId],
      foreignColumns: [ecritures.id],
      name: 'sales_accounting_event_entry_fk',
    }).onDelete('set null'),
    check(
      'sales_accounting_event_status_chk',
      sql`${table.status} in ('pending', 'projected', 'blocked')`,
    ),
    check('sales_accounting_event_attempts_chk', sql`${table.attempts} >= 0`),
    check(
      'sales_accounting_event_source_version_chk',
      sql`${table.sourceVersion} > 0`,
    ),
    check(
      'sales_accounting_event_projection_chk',
      sql`(${table.status} = 'projected' and ${table.accountingEntryId} is not null and ${table.projectedAt} is not null)
        or (${table.status} <> 'projected' and ${table.accountingEntryId} is null and ${table.projectedAt} is null)`,
    ),
  ],
);
