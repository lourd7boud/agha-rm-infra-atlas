// pg schema: bdc — avis d'achat par bon de commande (module /bdc du portail
// PMMP) + l'espace de travail de l'agent chargé (réponse chiffrée).
import {
  boolean,
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

export const bdc = pgSchema('bdc');

// Un avis d'achat publié — les articles arrivent STRUCTURÉS du portail:
// [{ numero, designation, caracteristiques, unite, quantite, tvaPct }].
export const bdcAvis = bdc.table(
  'avis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portalId: integer('portal_id').notNull(),
    reference: text('reference').notNull(),
    objet: text('objet').notNull(),
    acheteur: text('acheteur').notNull(),
    statut: text('statut').notNull().default('en_cours'), // en_cours|cloture|annule|attribue
    datePublication: timestamp('date_publication', { withTimezone: true }),
    dateLimite: timestamp('date_limite', { withTimezone: true }),
    lieu: text('lieu'),
    categorie: text('categorie'),
    naturePrestation: text('nature_prestation'),
    pieces: jsonb('pieces').notNull().default('[]'), // [{ label, downloadPath }]
    articles: jsonb('articles').notNull().default('[]'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_avis_portal_id_uniq').on(table.portalId),
    index('bdc_avis_statut_limite_idx').on(table.statut, table.dateLimite),
  ],
);

// Résultats publiés (intelligence concurrents): gagnant + montant TTC + nb de
// devis reçus, ou « infructueux ». Clé naturelle scopée acheteur (les
// références se répètent d'un acheteur à l'autre).
export const bdcResultats = bdc.table(
  'resultat',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    objet: text('objet').notNull(),
    acheteur: text('acheteur').notNull(),
    dateResultat: timestamp('date_resultat', { withTimezone: true }),
    nbDevis: integer('nb_devis'),
    issue: text('issue').notNull().default('infructueux'), // attribue | infructueux
    attributaire: text('attributaire'),
    montantTtc: numeric('montant_ttc', { precision: 14, scale: 2 }),
    avisId: uuid('avis_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_resultat_ref_acheteur_date_uniq').on(
      table.reference,
      table.acheteur,
      table.dateResultat,
    ),
    index('bdc_resultat_acheteur_idx').on(table.acheteur),
    index('bdc_resultat_attributaire_idx').on(table.attributaire),
    index('bdc_resultat_date_idx').on(table.dateResultat),
  ],
);

// La réponse de l'agent chargé — un chiffrage par avis (unique), avec la
// provenance de chaque prix: [{ idx, prixUnitaireHt, source, sourceRef, note }].
export const bdcReponses = bdc.table(
  'reponse',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    avisId: uuid('avis_id')
      .notNull()
      .references(() => bdcAvis.id),
    statut: text('statut').notNull().default('brouillon'), // brouillon|prete|deposee|gagnee|perdue
    margePct: numeric('marge_pct', { precision: 5, scale: 2 }).notNull().default('15'),
    lignes: jsonb('lignes').notNull().default('[]'),
    totalHt: numeric('total_ht', { precision: 14, scale: 2 }).notNull().default('0'),
    totalTva: numeric('total_tva', { precision: 14, scale: 2 }).notNull().default('0'),
    totalTtc: numeric('total_ttc', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('bdc_reponse_avis_uniq').on(table.avisId)],
);

export const bdcPricingRuns = bdc.table(
  'pricing_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    avisId: uuid('avis_id')
      .notNull()
      .references(() => bdcAvis.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    contentHash: text('content_hash').notNull(),
    actorId: text('actor_id').notNull(),
    status: text('status').notNull().default('queued'),
    stage: text('stage').notNull().default('analyse'),
    progressPct: integer('progress_pct').notNull().default(0),
    requestedMarkupPct: numeric('requested_markup_pct', { precision: 6, scale: 2 })
      .notNull()
      .default('15'),
    calibrationVersion: text('calibration_version').notNull(),
    warnings: jsonb('warnings').notNull().default('[]'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_pricing_run_avis_idempotency_uniq').on(
      table.avisId,
      table.idempotencyKey,
    ),
    index('bdc_pricing_run_avis_created_idx').on(table.avisId, table.createdAt),
    index('bdc_pricing_run_status_idx').on(table.status),
  ],
);

export const bdcPricingLineDecisions = bdc.table(
  'pricing_line_decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => bdcPricingRuns.id, { onDelete: 'cascade' }),
    lineIdx: integer('line_idx').notNull(),
    decision: jsonb('decision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_pricing_line_run_idx_uniq').on(table.runId, table.lineIdx),
  ],
);

export const bdcPriceObservations = bdc.table(
  'price_observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    designation: text('designation').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    unitPriceHtMad: numeric('unit_price_ht_mad', { precision: 16, scale: 4 }).notNull(),
    region: text('region'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    sourceUrl: text('source_url'),
    evidenceHash: text('evidence_hash').notNull(),
    verified: boolean('verified').notNull().default(false),
    reliability: numeric('reliability', { precision: 5, scale: 4 }).notNull(),
    metadata: jsonb('metadata').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_price_observation_hash_uniq').on(table.evidenceHash),
    index('bdc_price_observation_category_unit_date_idx').on(
      table.category,
      table.unit,
      table.observedAt,
    ),
  ],
);

export const bdcPricingFeedback = bdc.table(
  'pricing_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => bdcPricingRuns.id, { onDelete: 'cascade' }),
    lineIdx: integer('line_idx'),
    kind: text('kind').notNull(),
    unitPriceHtMad: numeric('unit_price_ht_mad', { precision: 16, scale: 4 }),
    actualCostHtMad: numeric('actual_cost_ht_mad', { precision: 16, scale: 4 }),
    winningAmountHtMad: numeric('winning_amount_ht_mad', { precision: 16, scale: 4 }),
    sourceRef: text('source_ref'),
    sourceUrl: text('source_url'),
    verified: boolean('verified').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bdc_pricing_feedback_verified_date_idx').on(table.verified, table.createdAt),
  ],
);

export const bdcPricingCalibrations = bdc.table(
  'pricing_calibration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull(),
    payload: jsonb('payload').notNull(),
    active: boolean('active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bdc_pricing_calibration_version_uniq').on(table.version),
    index('bdc_pricing_calibration_active_idx').on(table.active, table.createdAt),
  ],
);
