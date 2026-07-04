// pg schema: people — workforce register, chantier assignments & pointage.
import {
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

export const people = pgSchema('people');

// Workforce register — employees and their chantier assignments.
export const employees = people.table(
  'employee',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    fullName: text('full_name').notNull(),
    cin: text('cin'),
    metier: text('metier').notNull(),
    phone: text('phone'),
    status: text('status').notNull().default('actif'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The register is listed newest-first — keep that ordered read off a seq scan
    // as the workforce grows.
    index('employee_created_at_idx').on(table.createdAt),
  ],
);

// One active assignment per employee (enforced in application code).
export const assignments = people.table(
  'assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    startDate: date('start_date', { mode: 'date' }).notNull(),
    endDate: date('end_date', { mode: 'date' }),
    // Phase 3 — pay basis for the labour-cost rollup. Both nullable: a freshly
    // created assignment may carry no rate yet (dues fall back to 0 in
    // labor.domain). rateType ∈ {'jour','mois'} — validated at the edge; a 'mois'
    // rate is divided by WORKING_DAYS_PER_MONTH to get the effective daily rate.
    rateType: text('rate_type'),
    rateAmountMad: numeric('rate_amount_mad', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two hot read paths: an employee's assignment history and a chantier's
    // current crew. Plain btree indexes keep both off a seq scan as the log grows.
    index('assignment_employee_id_idx').on(table.employeeId),
    index('assignment_project_id_idx').on(table.projectId),
  ],
);

// Pointage — one logged work day per assignment. daysWorked allows half-days
// (0.5). Logging the same (assignment, date) UPSERTS (idempotent back-fill) so a
// re-submitted pointage replaces daysWorked + notes instead of double-counting.
export const workDays = people.table(
  'work_day',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    workDate: date('work_date', { mode: 'date' }).notNull(),
    daysWorked: numeric('days_worked', { precision: 4, scale: 2 })
      .notNull()
      .default('1'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Work days are always read per assignment — keep that list query off a seq
    // scan as the pointage log grows.
    index('work_day_assignment_id_idx').on(table.assignmentId),
    // One pointage per (assignment, day): lets a re-submitted log UPSERT on the
    // natural key instead of duplicating the day in the labour-cost rollup.
    uniqueIndex('work_day_assignment_date_uniq').on(
      table.assignmentId,
      table.workDate,
    ),
  ],
);
