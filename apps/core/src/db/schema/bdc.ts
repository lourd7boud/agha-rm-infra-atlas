// pg schema: bdc — avis d'achat par bon de commande (module /bdc du portail
// PMMP) + l'espace de travail de l'agent chargé (réponse chiffrée).
import {
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
