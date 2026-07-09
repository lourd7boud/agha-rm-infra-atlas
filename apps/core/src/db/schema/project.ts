// pg schema: project — chantiers, situations, avenants, journaux & tâches.
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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
  // ── Fields ported from the BTP construction-management app (marché de travaux
  //    details); all nullable/additive so existing chantier rows are untouched.
  objet: text('objet'), // full marché object (long); `name` stays the short label
  annee: text('annee'),
  societe: text('societe'), // entreprise attributaire (our company / groupement)
  commune: text('commune'),
  typeMarche: text('type_marche'), // 'normal' | 'reconductible' | ...
  modePassation: text('mode_passation'),
  delaiExecutionJours: integer('delai_execution_jours'),
  dateOuverture: date('date_ouverture', { mode: 'date' }),
  receptionProvisoire: date('reception_provisoire', { mode: 'date' }),
  receptionDefinitive: date('reception_definitive', { mode: 'date' }),
  achevementTravaux: date('achevement_travaux', { mode: 'date' }),
  assistanceTechnique: text('assistance_technique'),
  maitreOeuvre: text('maitre_oeuvre'),
  progressPct: numeric('progress_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  // Original btpdb owner id, kept for traceability of migrated rows.
  legacyUserId: uuid('legacy_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Situation de travaux / décompte provisoire (CCAG-T): cumulative amounts;
// the period delta + retenue de garantie are derived in the domain layer.
export const situations = project.table(
  'situation',
  {
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
  },
  (table) => [
    // Situations are always read per chantier — keep that list query off a seq scan.
    index('situation_project_id_idx').on(table.projectId),
  ],
);

// Avenant — contract amendment changing amount and/or delay. The décompte
// ceiling becomes montant marché + sum of approved avenant deltas.
export const avenants = project.table(
  'avenant',
  {
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
  },
  (table) => [
    // Avenants are always read per chantier — keep that list query off a seq scan.
    index('avenant_project_id_idx').on(table.projectId),
  ],
);

// Journal de chantier — daily site report filed by the terrain role.
// One report per project per day (enforced in application code).
export const dailyLogs = project.table(
  'daily_log',
  {
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
  },
  (table) => [
    // Daily logs are always read per chantier — keep that list query off a seq scan.
    index('daily_log_project_id_idx').on(table.projectId),
  ],
);

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

// ============================================================================
// Execution-detail tables ported from the BTP construction-management app.
// These model the marché lifecycle at line-item granularity: bordereau (BPU) →
// périodes → métré → décompte (+ révision des prix). Line items are stored as
// jsonb (as in the source app) so the existing calculation engines can be reused
// verbatim; period/décompte totals are also persisted as columns for fast reads.
// ============================================================================

// Bordereau des prix (BPU) — the priced bill of quantities for a chantier.
export const bordereaux = project.table(
  'bordereau',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    // [{ prixNo, designation, unite, quantite, prixUnitaire, montant }, …]
    lignes: jsonb('lignes').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bordereau_project_id_idx').on(table.projectId)],
);

// Période — a billing period of a chantier (carries its TVA/retenue rates and the
// cumulative context needed by the décompte récapitulatif).
export const periodes = project.table(
  'periode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    numero: integer('numero').notNull(),
    libelle: text('libelle'),
    dateDebut: date('date_debut', { mode: 'date' }),
    dateFin: date('date_fin', { mode: 'date' }),
    tauxTva: numeric('taux_tva', { precision: 5, scale: 2 }).notNull().default('20'),
    tauxRetenue: numeric('taux_retenue', { precision: 5, scale: 2 }).notNull().default('10'),
    decomptesPrecedents: numeric('decomptes_precedents', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    depensesExercicesAnterieurs: numeric('depenses_exercices_anterieurs', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    isDecompteDernier: boolean('is_decompte_dernier').notNull().default(false),
    statut: text('statut').notNull().default('en_cours'),
    observations: text('observations'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('periode_project_id_idx').on(table.projectId)],
);

// Métré — hierarchical measurement (sections/sous-sections/lignes with mesures)
// feeding a décompte line's realised quantity.
export const metres = project.table(
  'metre',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    periodeId: uuid('periode_id').references(() => periodes.id),
    bordereauLigneId: text('bordereau_ligne_id'),
    designation: text('designation'),
    unite: text('unite'),
    // { sections, sousSections, lignes, mesures } — full métré tree.
    data: jsonb('data').notNull().default('{}'),
    totalQuantite: numeric('total_quantite', { precision: 16, scale: 4 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('metre_project_id_idx').on(table.projectId)],
);

// Décompte (line-item, BTP-style) — distinct from the simpler cumulative
// `situation` used by finance. Carries the priced lines + HT/TVA/TTC totals and
// the récapitulatif (retenue de garantie, net à payer / acompte).
export const decomptes = project.table(
  'decompte',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    periodeId: uuid('periode_id').references(() => periodes.id),
    numero: integer('numero').notNull(),
    dateDecompte: date('date_decompte', { mode: 'date' }),
    lignes: jsonb('lignes').notNull().default('[]'),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 }).notNull().default('0'),
    montantTvaMad: numeric('montant_tva_mad', { precision: 14, scale: 2 }).notNull().default('0'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 }).notNull().default('0'),
    totalGeneralTtcMad: numeric('total_general_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    montantCumuleMad: numeric('montant_cumule_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    montantPrecedentMad: numeric('montant_precedent_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    montantActuelMad: numeric('montant_actuel_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    retenueGarantieMad: numeric('retenue_garantie_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    netAPayerMad: numeric('net_a_payer_mad', { precision: 14, scale: 2 }).notNull().default('0'),
    isDernier: boolean('is_dernier').notNull().default(false),
    statut: text('statut').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('decompte_project_id_idx').on(table.projectId)],
);

// Révision des prix — reusable index-revision formula (P = P0·[a + Σ wᵢ·Iᵢ/Iᵢ0]).
export const revisionFormulas = project.table('revision_formula', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  fixedPart: numeric('fixed_part', { precision: 6, scale: 4 }).notNull().default('0.15'),
  // { "At": 0.20, "Cs": 0.25, … } — dynamic index weights.
  weights: jsonb('weights').notNull().default('{}'),
  isDefault: boolean('is_default').notNull().default(false),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Monthly official index values (one row per month).
export const revisionIndexes = project.table('revision_index', {
  id: uuid('id').primaryKey().defaultRandom(),
  monthDate: date('month_date', { mode: 'date' }).notNull().unique(),
  // { "At": 306.7, "Cs": 134.6, … }
  indexValues: jsonb('index_values').notNull().default('{}'),
  source: text('source'),
  status: text('status').notNull().default('provisoire'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per-chantier révision configuration (chosen formula + base-period indexes).
export const projectRevisionConfig = project.table('project_revision_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  formulaId: uuid('formula_id').references(() => revisionFormulas.id),
  baseIndexes: jsonb('base_indexes').notNull().default('{}'),
  baseDate: date('base_date', { mode: 'date' }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Computed révision for a given décompte (coefficient + montant).
export const decompteRevisions = project.table(
  'decompte_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decompteId: uuid('decompte_id')
      .notNull()
      .unique()
      .references(() => decomptes.id),
    montantAReviser: numeric('montant_a_reviser', { precision: 14, scale: 2 }),
    coefficientApplique: numeric('coefficient_applique', { precision: 12, scale: 6 }),
    montantRevision: numeric('montant_revision', { precision: 14, scale: 2 }),
    calculationDetails: jsonb('calculation_details'),
    status: text('status').notNull().default('calculated'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('decompte_revision_decompte_id_idx').on(table.decompteId)],
);
