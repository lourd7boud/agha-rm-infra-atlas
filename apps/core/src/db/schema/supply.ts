// pg schema: supply — native procurement (suppliers, bons de commande, factures fournisseurs).
import {
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

// Native procurement (Odoo-replacement slice 1): suppliers, bons de
// commande, factures fournisseurs — our roles, our audit, no external ERP.
export const supply = pgSchema('supply');

export const suppliers = supply.table('supplier', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  name: text('name').notNull(),
  /** Identifiant Commun de l'Entreprise — Moroccan business id. */
  ice: text('ice'),
  phone: text('phone'),
  email: text('email'),
  status: text('status').notNull().default('actif'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = supply.table('purchase_order', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  projectId: uuid('project_id').references(() => projects.id),
  reference: text('reference').notNull(),
  objet: text('objet').notNull(),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  status: text('status').notNull().default('brouillon'),
  orderedAt: date('ordered_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Bon de commande line items — inserted with the parent order (mirrors the
// sales quote_line/invoice_line pattern). When lines are supplied, the order's
// amount_mad is the Σ of these line totals; legacy orders carry none.
export const purchaseOrderLines = supply.table(
  'purchase_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the order — deleting the parent cascades.
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [
    index('supply_purchase_order_line_order_id_idx').on(table.purchaseOrderId),
  ],
);

export const supplierInvoices = supply.table('supplier_invoice', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  reference: text('reference').notNull(),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  invoiceDate: date('invoice_date', { mode: 'date' }).notNull(),
  dueDate: date('due_date', { mode: 'date' }).notNull(),
  status: text('status').notNull().default('recue'),
  paidAt: date('paid_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
