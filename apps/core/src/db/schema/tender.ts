// pg schema: tender — public-procurement tenders, buyers, outcomes, lists & reference dimensions.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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

// Postgres tsvector — populated exclusively by the tender_fts_refresh trigger
// (see drizzle/0027_tender_dual_fts.sql). Declared here so drizzle-kit
// generate treats the columns as part of the schema and never emits a DROP.
// Application code reads via raw SQL (websearch_to_tsquery); never writes.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Each ATLAS module owns its PostgreSQL schema (enterprise-architecture §3).
export const tender = pgSchema('tender');

export const buyers = tender.table('buyer', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  buyerType: text('buyer_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenders = tender.table('tender', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  reference: text('reference').notNull(),
  buyerId: uuid('buyer_id').references(() => buyers.id),
  buyerName: text('buyer_name').notNull(),
  procedure: text('procedure').notNull(),
  objet: text('objet').notNull(),
  // Lieu d'exécution (panelBlocLieuxExec) — the real geographic field, distinct
  // from buyer_name (the acheteur). Nullable: legacy rows + sources without it.
  location: text('location'),
  estimationMad: numeric('estimation_mad', { precision: 14, scale: 2 }),
  cautionProvisoireMad: numeric('caution_provisoire_mad', { precision: 14, scale: 2 }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  pipelineState: text('pipeline_state').notNull().default('detected'),
  qualification: jsonb('qualification'),
  sourceUrl: text('source_url'),
  raw: jsonb('raw'),
  // Datao-parity dual-lane French FTS. Both are trigger-owned (see migration
  // 0027_tender_dual_fts.sql): fts_search folds reference/objet/buyer_name/
  // location/summary; fts_bdp_search folds every raw.dossierExtraction.bpu[]
  // designation so a search for "câbles électriques" hits tenders whose BPU
  // carries that line item, matching datao's competitive discovery UX.
  ftsSearch: tsvector('fts_search'),
  ftsBdpSearch: tsvector('fts_bdp_search'),
  // Datao-parity atomic dimensions (migration 0029_tender_parity_columns.sql).
  // Populated by DossierExtractionService as it processes each tender.
  isSimplified: boolean('is_simplified').notNull().default(false),
  rectified: boolean('rectified').notNull().default(false),
  milestonesCount: integer('milestones_count'),
  attributedAt: timestamp('attributed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // source_url (the canonical EntrepriseDetailsConsultation URL carrying
  // refConsultation) is the STABLE dedup + heal key. Enforce one row per
  // consultation so a heal can never silently mass-overwrite twins and create()
  // can never duplicate an existing consultation. Partial: legacy/source-less
  // rows keep NULL (Postgres treats NULLs as distinct anyway).
  uniqueIndex('tender_source_url_uniq')
    .on(table.sourceUrl)
    .where(sql`${table.sourceUrl} IS NOT NULL`),
  // Hot-column btree indexes for the datao-style read path
  // (docs/architecture/SCALABLE-READ-ARCHITECTURE.md). Before these, ordering,
  // faceting and the create() dedup probe were full sequential scans of the
  // whole table incl. the heavy `raw` jsonb. created_at DESC backs the default
  // publication-desc sort + keyset pagination; deadline_at backs the deadline
  // wall; procedure/pipeline_state/buyer_name back facet filters; the composite
  // (reference, buyer_name) backs the create() duplicate probe.
  index('tender_created_at_idx').on(table.createdAt.desc()),
  index('tender_deadline_at_idx').on(table.deadlineAt),
  index('tender_procedure_idx').on(table.procedure),
  index('tender_pipeline_state_idx').on(table.pipelineState),
  index('tender_buyer_name_idx').on(table.buyerName),
  index('tender_reference_buyer_idx').on(table.reference, table.buyerName),
]);

// ── Phase 0 — Socle de vérité ────────────────────────────────────────────────

// The reward signal: the real result of OUR bids joined to the price we
// proposed. Without this table no learning loop can close (recon: déficit #0).
export const submissionOutcomes = tender.table('submission_outcome', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id),
  result: text('result').notNull(),
  montantSoumisMad: numeric('montant_soumis_mad', { precision: 14, scale: 2 }),
  rabaisRetenuPct: numeric('rabais_retenu_pct', { precision: 5, scale: 2 }),
  scenarioChoisi: text('scenario_choisi'),
  ourRank: integer('our_rank'),
  winnerAmountMad: numeric('winner_amount_mad', { precision: 14, scale: 2 }),
  gapToFirstPct: numeric('gap_to_first_pct', { precision: 7, scale: 2 }),
  motifRejet: text('motif_rejet'),
  lessons: jsonb('lessons'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only transition history — replaces the single mutable pipeline_state
// column so we can measure stage durations and detected→won conversion.
export const tenderEvents = tender.table('tender_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Listes & recherches sauvegardées (datao "Listes" + "Recherches sauvegardées") ──
// A user organizes tenders into named folders (Privée by default; visibility
// extendable to Partagée later) and saves complex filter sets as named searches.
// Owned by the application user id (Keycloak sub) — multi-tenant via companyId.
export const tenderLists = tender.table(
  'list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    /** Keycloak `sub` of the owner. Multi-user team sharing builds on this later. */
    ownerSub: text('owner_sub').notNull(),
    name: text('name').notNull(),
    /** 'private' (only owner) | 'shared' (everyone in the company). */
    visibility: text('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One list-name per (company, owner) so re-saving the same name updates the
    // list instead of duplicating it.
    uniqueIndex('tender_list_owner_name_uniq').on(
      table.companyId,
      table.ownerSub,
      table.name,
    ),
    index('tender_list_owner_idx').on(table.ownerSub),
  ],
);

export const tenderListMembers = tender.table(
  'list_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => tenderLists.id, { onDelete: 'cascade' }),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per (list, tender) — re-adding is a no-op via ON CONFLICT.
    uniqueIndex('tender_list_member_uniq').on(table.listId, table.tenderId),
    index('tender_list_member_list_idx').on(table.listId),
    index('tender_list_member_tender_idx').on(table.tenderId),
  ],
);

export const tenderSavedSearches = tender.table(
  'saved_search',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    ownerSub: text('owner_sub').notNull(),
    name: text('name').notNull(),
    visibility: text('visibility').notNull().default('private'),
    /** The full FilterState as JSON — opaque to the server, replayed by the web. */
    filters: jsonb('filters').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tender_saved_search_owner_name_uniq').on(
      table.companyId,
      table.ownerSub,
      table.name,
    ),
    index('tender_saved_search_owner_idx').on(table.ownerSub),
  ],
);

// ── Datao-parity reference dimensions (seeded with datao's exact UUIDs in
// migration 0028_tender_reference_tables.sql). Sharing the same IDs makes
// bidder/tender records referencing a foreign UUID resolve trivially.

export const tenderStatuses = tender.table('tender_status', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  sortId: integer('sort_id').notNull(),
});

export const tenderCategories = tender.table('tender_category', {
  id: uuid('id').primaryKey(),
  label: text('label').notNull().unique(),
});

// cluster: 'PUBLIC' = Marchés publics (État & collectivités),
//          'EEP'    = Établissements & Entreprises Publics.
export const tenderModes = tender.table('tender_mode', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  cluster: text('cluster').notNull(),
}, (table) => [
  check('tender_mode_cluster_check', sql`${table.cluster} IN ('PUBLIC', 'EEP')`),
]);

export const subModes = tender.table('sub_mode', {
  id: uuid('id').primaryKey(),
  modeId: uuid('mode_id').notNull().references(() => tenderModes.id),
  code: text('code').notNull(),
  label: text('label').notNull(),
}, (table) => [
  uniqueIndex('sub_mode_mode_code_uniq').on(table.modeId, table.code),
]);

export const regions = tender.table('region', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const bidderStatuses = tender.table('bidder_status', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
});
