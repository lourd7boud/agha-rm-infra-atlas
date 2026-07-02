// pg schema: project — chantiers, situations, avenants, journaux & tâches.
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
import { tenders } from './tender';

export const project = pgSchema('project');

// A chantier — born from a won tender or registered manually.
export const projects = project.table('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  tenderId: uuid('tender_id').references(() => tenders.id),
  reference: text('reference').notNull(),
  name: text('name').notNull(),
  buyerName: text('buyer_name').notNull(),
  montantMarcheMad: numeric('montant_marche_mad', { precision: 14, scale: 2 }).notNull(),
  ordreServiceDate: date('ordre_service_date', { mode: 'date' }),
  delaiMois: numeric('delai_mois', { precision: 4, scale: 1 }),
  status: text('status').notNull().default('preparation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Situation de travaux / décompte provisoire (CCAG-T): cumulative amounts;
// the period delta + retenue de garantie are derived in the domain layer.
export const situations = project.table('situation', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  numero: integer('numero').notNull(),
  periodEnd: date('period_end', { mode: 'date' }).notNull(),
  montantCumuleMad: numeric('montant_cumule_mad', { precision: 14, scale: 2 }).notNull(),
  montantPeriodeMad: numeric('montant_periode_mad', { precision: 14, scale: 2 }).notNull(),
  retenueGarantieMad: numeric('retenue_garantie_mad', { precision: 14, scale: 2 }).notNull(),
  netAPayerMad: numeric('net_a_payer_mad', { precision: 14, scale: 2 }).notNull(),
  avancementPct: numeric('avancement_pct', { precision: 5, scale: 2 }).notNull(),
  status: text('status').notNull().default('brouillon'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Avenant — contract amendment changing amount and/or delay. The décompte
// ceiling becomes montant marché + sum of approved avenant deltas.
export const avenants = project.table('avenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  numero: integer('numero').notNull(),
  objet: text('objet').notNull(),
  montantDeltaMad: numeric('montant_delta_mad', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  delaiDeltaMois: numeric('delai_delta_mois', { precision: 4, scale: 1 })
    .notNull()
    .default('0'),
  approvedAt: date('approved_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Journal de chantier — daily site report filed by the terrain role.
// One report per project per day (enforced in application code).
export const dailyLogs = project.table('daily_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  reportDate: date('report_date', { mode: 'date' }).notNull(),
  effectifs: integer('effectifs').notNull(),
  travauxRealises: text('travaux_realises').notNull(),
  materiel: text('materiel'),
  meteo: text('meteo'),
  blocages: text('blocages'),
  incidentsSecurite: integer('incidents_securite').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Tâches de chantier — the physical work-breakdown for a project. Progress here
// is PHYSICAL avancement (per-task % rolled up in task.domain), deliberately
// SEPARATE from the situation-based financial avancement above.
export const tasks = project.table(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    label: text('label').notNull(),
    description: text('description'),
    progressPct: numeric('progress_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    // status ∈ {'a_faire','en_cours','termine','bloque'} — validated at the edge.
    status: text('status').notNull().default('a_faire'),
    startDate: date('start_date', { mode: 'date' }),
    dueDate: date('due_date', { mode: 'date' }),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Tasks are always read per chantier — keep that list query off a seq scan.
    index('task_project_id_idx').on(table.projectId),
  ],
);
