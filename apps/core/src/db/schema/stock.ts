// pg schema: stock — materials, depots & append-only stock movement ledger.
import {
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

// ── Stock & matériaux — native warehouse/site materials ledger ───────────────
// Materials and depots are the dimensions; every quantity change is an
// append-only stock_movement event. Balances and per-chantier consumption are
// derived in stock.domain from the event log — the tables hold no running total.
export const stock = pgSchema('stock');

// A material reference (sac de ciment, m3 de béton, tonne d'acier…). Unit and
// optional standard cost live here; cost can be overridden per movement.
export const materials = stock.table(
  'material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    code: text('code').notNull(),
    designation: text('designation').notNull(),
    // e.g. 'sac','m3','tonne','u','kg','ml' — free text, validated at the edge.
    unit: text('unit').notNull(),
    category: text('category'),
    unitCostMad: numeric('unit_cost_mad', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One material per (company, code): lets re-imports upsert on the code
    // instead of duplicating the reference.
    uniqueIndex('stock_material_company_code_uniq').on(
      table.companyId,
      table.code,
    ),
  ],
);

// A storage location — central depot or a chantier's on-site stock.
export const depots = stock.table(
  'depot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    name: text('name').notNull(),
    location: text('location'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One depot per (company, name): the natural upsert key for re-imports.
    uniqueIndex('stock_depot_company_name_uniq').on(table.companyId, table.name),
  ],
);

// Append-only event log: no update/delete path exists in application code.
// kind ∈ {'initial','purchase','transfer','consumption','adjustment'}. Balances
// and project consumption are folded from these rows in stock.domain; there is
// deliberately NO unique constraint — every harvest is a distinct event.
export const stockMovements = stock.table(
  'stock_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    // Optional override of the material's standard cost for this movement.
    unitCostMad: numeric('unit_cost_mad', { precision: 14, scale: 2 }),
    // Source depot — set for consumption/transfer/adjustment-out; null otherwise.
    fromDepotId: uuid('from_depot_id').references(() => depots.id),
    // Destination depot — set for initial/purchase/transfer/adjustment-in.
    toDepotId: uuid('to_depot_id').references(() => depots.id),
    // The chantier consuming the material (site consumption only); null otherwise.
    projectId: uuid('project_id').references(() => projects.id),
    reference: text('reference'),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The four FK columns each back a hot read path folded from this log:
    // per-material balance roll-ups, per-depot stock queries (source/dest), and
    // per-chantier consumption. Plain btree indexes keep those from degrading to
    // sequential scans as the append-only event log grows.
    index('stock_movement_material_id_idx').on(table.materialId),
    index('stock_movement_from_depot_id_idx').on(table.fromDepotId),
    index('stock_movement_to_depot_id_idx').on(table.toDepotId),
    index('stock_movement_project_id_idx').on(table.projectId),
  ],
);
