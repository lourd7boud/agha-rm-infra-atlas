// pg schema: intel — competitor register and harvested competitor bids.
import {
  boolean,
  date,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenders } from './tender';

export const intel = pgSchema('intel');

export const competitors = intel.table('competitor', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Permanent archive of every published result/PV notice we ever fetched —
 * the ACQUISITION half of the 129k-notice backfill. Crawl + OCR happen once
 * (free: network + CPU); the LLM/deterministic INTERPRETATION reads ocr_text
 * later at whatever pace the daily budget allows, and can re-run forever
 * without touching the portal again.
 */
export const resultNotices = intel.table(
  'result_notice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Portal annonce type: '4' résultat définitif, '5' extrait de PV. */
    annonceType: text('annonce_type').notNull(),
    /** The portal's idAvis (EntrepriseDownloadAvisJAL&idAvis=N) — dedupe key. */
    idAvis: text('id_avis').notNull(),
    sourceUrl: text('source_url'),
    /** Listing-row context when available (helps interpretation + joins). */
    reference: text('reference'),
    buyerName: text('buyer_name'),
    /** OCR'd notice text (null until acquired; empty text → status 'empty'). */
    ocrText: text('ocr_text'),
    bytesSize: numeric('bytes_size', { precision: 12, scale: 0 }),
    /** acquired → interpreted | empty | error (interpretation verdicts). */
    status: text('status').notNull().default('acquired'),
    error: text('error'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    interpretedAt: timestamp('interpreted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('result_notice_id_avis_uniq').on(table.idAvis)],
);

/**
 * Single-row store of the expert agent's precomputed knowledge base. The
 * worker recomputes it in the background (after each sweep); the API serves
 * it in one tiny read — user latency stays constant no matter how large the
 * catalogue and the bid archive grow.
 */
export const knowledgeSnapshots = intel.table('knowledge_snapshot', {
  id: numeric('id', { precision: 1, scale: 0 }).primaryKey(),
  payload: text('payload').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

export const competitorBids = intel.table(
  'competitor_bid',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    buyerName: text('buyer_name').notNull(),
    bidderName: text('bidder_name').notNull(),
    competitorId: uuid('competitor_id').references(() => competitors.id),
    // Phase 0: the join key to the avis we saw. Nullable until back-filled by
    // reference — the estimation↔attribution rebate depends on this link.
    tenderId: uuid('tender_id').references(() => tenders.id),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }),
    // The administrative estimation read off the result notice (vision). Together
    // with amount_mad this yields the recovered winning rebate — the calibration
    // GOLD. Often null on a résultat-définitif notice; captured when present.
    estimationMad: numeric('estimation_mad', { precision: 14, scale: 2 }),
    // Market object as printed on the notice — feeds segment inference for the
    // per-segment rebate benchmarks.
    objet: text('objet'),
    isWinner: boolean('is_winner').notNull().default(false),
    resultDate: date('result_date', { mode: 'date' }),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One bid per (avis, competitor): lets the result-crawler harvest and the
    // PV harvest race without producing duplicate rows that would double-count a
    // winner in the rebate calibration. competitor_id is nullable but always set
    // in practice; NULLs are distinct in Postgres, which is fine here.
    uniqueIndex('competitor_bid_reference_competitor_uniq').on(
      table.reference,
      table.competitorId,
    ),
    // Reference-scoped lookup for the bounded inventory bid join — replaces the
    // full `SELECT * FROM competitor_bid` (listAllBids) in the hot read path
    // once the bid table grows (heading to 150-300k rows).
    index('competitor_bid_reference_idx').on(table.reference),
  ],
);
