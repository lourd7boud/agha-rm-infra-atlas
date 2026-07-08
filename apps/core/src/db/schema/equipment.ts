// pg schema: equipment — matériel & engins register + chantier assignments,
// plus the GMAO layer (compliance documents, usage meters, work orders).
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

// ── Matériel & engins — equipment register + chantier assignment ─────────────
// Machines and tools (distinct from people.assignment, which posts WORKERS to a
// chantier): equipment.equipment is the inventory dimension; equipment.assignment
// posts a MACHINE to a project with a date de retour prévue. status mirrors the
// open-assignment lifecycle — 'disponible' when idle, 'assignee' while posted,
// 'hors_service' when broken. assign/return move status transactionally so the
// inventory and the assignment log never disagree.
export const equipment = pgSchema('equipment');

export const equipments = equipment.table(
  'equipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    code: text('code'),
    name: text('name').notNull(),
    category: text('category'),
    // Identity fields (optional) — the parc-matériel dimension: manufacturer,
    // model, chassis/serial and plate. Nullable so the light register still
    // works; enriched over time (back-fill upsert keeps non-null values).
    marque: text('marque'),
    modele: text('modele'),
    numeroSerie: text('numero_serie'),
    immatriculation: text('immatriculation'),
    // status ∈ {'disponible','assignee','hors_service'} — validated at the edge
    // and enforced by the equipment.domain transition guards on assign/return.
    status: text('status').notNull().default('disponible'),
    acquisitionDate: date('acquisition_date', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One machine per (company, name): lets re-imports upsert on the name
    // instead of duplicating the reference.
    uniqueIndex('equipment_company_name_uniq').on(table.companyId, table.name),
    // The availability board reads by status — keep it off a seq scan.
    index('equipment_status_idx').on(table.status),
    // Defence-in-depth: the domain guards (assertAssign/assertReturn/
    // assertSetStatus) live in application code; this DB-level CHECK stops any
    // direct INSERT/UPDATE (migration, DB admin, another service) from writing
    // an unrecognised status that would crash the status-badge UI. Literals
    // mirror EQUIPMENT_STATUSES in equipment.domain — keep the two in sync.
    check(
      'equipment_status_check',
      sql`${table.status} IN ('disponible', 'assignee', 'hors_service')`,
    ),
  ],
);

// One posting of a machine to a chantier. An OPEN row (returnedAt null) is the
// machine's current assignment; closing it (returnedAt set) frees the machine.
export const equipmentAssignments = equipment.table(
  'assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipments.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    assignedAt: date('assigned_at', { mode: 'date' }).notNull(),
    // Date de retour prévue — when the machine is expected back; null if open-ended.
    expectedReturnAt: date('expected_return_at', { mode: 'date' }),
    // Set when the machine is returned; null while the assignment is open.
    returnedAt: date('returned_at', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two hot read paths: a machine's assignment history and a chantier's
    // current fleet. Plain btree indexes keep both off a seq scan as the log grows.
    index('equipment_assignment_equipment_id_idx').on(table.equipmentId),
    index('equipment_assignment_project_id_idx').on(table.projectId),
    // Finding a machine's CURRENT (open) assignment is the assign/return hot
    // path — a partial index over just the open rows keeps it tiny and off a
    // seq scan no matter how long the historical assignment log grows.
    index('equipment_assignment_open_idx')
      .on(table.equipmentId)
      .where(sql`${table.returnedAt} IS NULL`),
  ],
);

// ── Documents — compliance papers with expiry ────────────────────────────────
// Assurance, carte grise, contrôle technique, visite technique… Each row is one
// document with an optional expiry date; the fleet dashboard scans expiry_date
// to surface "expire dans ≤30j" — the highest legal/safety-ROI feature. type
// mirrors EQUIPMENT_DOCUMENT_TYPES in equipment.maintenance.domain.
export const equipmentDocuments = equipment.table(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipments.id),
    type: text('type').notNull(),
    reference: text('reference'),
    issueDate: date('issue_date', { mode: 'date' }),
    // Null = permanent document (nothing to renew); set = renewal deadline.
    expiryDate: date('expiry_date', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('equipment_document_equipment_id_idx').on(table.equipmentId),
    // The fleet-wide "expiring soon" scan reads by expiry_date — keep it off a
    // seq scan as the document log grows.
    index('equipment_document_expiry_idx').on(table.expiryDate),
    check(
      'equipment_document_type_check',
      sql`${table.type} IN ('assurance', 'carte_grise', 'controle_technique', 'visite_technique', 'autorisation', 'autre')`,
    ),
  ],
);

// ── Meter readings — usage log (heures / km) ─────────────────────────────────
// One row per reading; the machine's CURRENT meter is the latest reading. Usage
// is the backbone of preventive maintenance ("service every N heures"). unit
// mirrors METER_UNITS; value is numeric so partial hours/km are exact.
export const equipmentMeterReadings = equipment.table(
  'meter_reading',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipments.id),
    readingDate: date('reading_date', { mode: 'date' }).notNull(),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    unit: text('unit').notNull(),
    source: text('source').notNull().default('manuel'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Latest-reading-per-machine read path: (equipment_id, reading_date) lets
    // Postgres resolve the current value with a backward index scan.
    index('equipment_meter_reading_latest_idx').on(
      table.equipmentId,
      table.readingDate,
    ),
    check(
      'equipment_meter_reading_unit_check',
      sql`${table.unit} IN ('heures', 'km')`,
    ),
  ],
);

// ── Work orders — bons d'intervention (préventif / correctif) ────────────────
// A breakdown declaration or a scheduled service. Moves ouvert → en_cours →
// clos (guarded by assertWorkOrderTransition). cost_mad drives the cost-per-
// machine rollup; meter_at_service records the usage at intervention time. type
// and status mirror WORK_ORDER_TYPES / WORK_ORDER_STATUSES in the domain.
export const equipmentWorkOrders = equipment.table(
  'work_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipments.id),
    type: text('type').notNull(),
    status: text('status').notNull().default('ouvert'),
    title: text('title').notNull(),
    description: text('description'),
    reportedBy: text('reported_by'),
    openedAt: date('opened_at', { mode: 'date' }).notNull(),
    completedAt: date('completed_at', { mode: 'date' }),
    meterAtService: numeric('meter_at_service', { precision: 12, scale: 2 }),
    costMad: numeric('cost_mad', { precision: 14, scale: 2 }),
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('equipment_work_order_equipment_id_idx').on(table.equipmentId),
    index('equipment_work_order_status_idx').on(table.status),
    check(
      'equipment_work_order_type_check',
      sql`${table.type} IN ('preventif', 'correctif')`,
    ),
    check(
      'equipment_work_order_status_check',
      sql`${table.status} IN ('ouvert', 'en_cours', 'clos')`,
    ),
  ],
);
