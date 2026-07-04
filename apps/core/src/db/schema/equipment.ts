// pg schema: equipment — matériel & engins register + chantier assignments.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
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
