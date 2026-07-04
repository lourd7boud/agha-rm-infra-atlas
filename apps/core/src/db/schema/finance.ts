// pg schema: finance — cautions (bank guarantees), recettes & dépenses.
import {
  date,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenders } from './tender';
import { projects } from './project';
import { suppliers } from './supply';

export const finance = pgSchema('finance');

// Bank guarantees register — cash locked at banks until release.
// kind: provisoire (per tender) | definitive | retenue_remplacee (per project).
export const cautions = finance.table('caution', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  kind: text('kind').notNull(),
  reference: text('reference').notNull(),
  tenderId: uuid('tender_id').references(() => tenders.id),
  projectId: uuid('project_id').references(() => projects.id),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  bankName: text('bank_name'),
  issuedAt: date('issued_at', { mode: 'date' }).notNull(),
  releasedAt: date('released_at', { mode: 'date' }),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Recettes / encaissements — money IN (TGR payments, acomptes, avances).
// method ∈ {virement,cheque,espece,effet,autre} — validated at the edge.
export const payments = finance.table(
  'payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    projectId: uuid('project_id').references(() => projects.id),
    label: text('label').notNull(),
    payerName: text('payer_name'),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    method: text('method').notNull().default('virement'),
    transferReference: text('transfer_reference'),
    bankName: text('bank_name'),
    paidAt: date('paid_at', { mode: 'date' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Cashflow per chantier reads payments by project — keep it off a seq scan.
    index('payment_project_id_idx').on(table.projectId),
    // The recettes ledger is listed newest-first — keep that ordered read off a
    // seq scan as the cashflow log grows.
    index('payment_created_at_idx').on(table.createdAt),
  ],
);

// Dépenses — money OUT, classified by category (location_materiel, materiaux,
// main_oeuvre, carburant, transport, sous_traitance, administratif, taxes, autre).
export const expenses = finance.table(
  'expense',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    projectId: uuid('project_id').references(() => projects.id),
    category: text('category').notNull(),
    label: text('label').notNull(),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    method: text('method'),
    reference: text('reference'),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    spentAt: date('spent_at', { mode: 'date' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // By-category summary + per-chantier cashflow are the two hot read paths.
    index('expense_category_idx').on(table.category),
    index('expense_project_id_idx').on(table.projectId),
    // Supplier-scoped expense reports (all dépenses for fournisseur X) + joins
    // to supply.supplier must not seq-scan finance.expense as it grows.
    index('expense_supplier_id_idx').on(table.supplierId),
    // The dépenses ledger is listed newest-first — keep that ordered read off a
    // seq scan as the cashflow log grows.
    index('expense_created_at_idx').on(table.createdAt),
  ],
);
