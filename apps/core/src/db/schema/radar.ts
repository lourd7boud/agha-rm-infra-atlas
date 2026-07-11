// pg schema: radar — l'avis scoré de la société sur chaque marché en cours.
// Une opinion par avis (tender_id unique), rescorable, avec sa ventilation et
// son cycle de vie. Le radar proactif (Niveau 4) transforme le catalogue en
// une courte liste priorisée « à traiter aujourd'hui ».
import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenders } from './tender';

export const radar = pgSchema('radar');

export const radarCandidates = radar.table(
  'candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    /** Score d'opportunité 0-100. */
    score: integer('score').notNull().default(0),
    /** Ventilation par dimension (categorie/proximite/delai/taille/…) 0..1. */
    breakdown: jsonb('breakdown').notNull().default('{}'),
    /** Raisons lisibles (meilleures d'abord + drapeaux). */
    reasons: jsonb('reasons').notNull().default('[]'),
    /** Cycle de vie: nouveau | vu | poursuivi | ecarte. */
    statut: text('statut').notNull().default('nouveau'),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('radar_candidate_tender_uniq').on(table.tenderId),
    index('radar_candidate_score_idx').on(table.score.desc()),
    index('radar_candidate_statut_idx').on(table.statut),
  ],
);
