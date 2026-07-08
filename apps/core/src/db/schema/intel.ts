// pg schema: intel — competitor register and harvested competitor bids.
import { sql } from 'drizzle-orm';
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
    // Canonical buyer identity, DERIVED from buyer_name by the database (lower +
    // non-alnum→space + collapse, accent-preserving). The immutable SQL twin of
    // buyerIdentityKey() in intel.repository.ts, so the in-memory and SQL dedupe
    // paths agree. It exists purely to widen the bid-uniqueness key below: portal
    // references (e.g. "05/2026") are reused across 654 acheteurs, so keying on
    // (reference, competitor) alone MERGED one competitor's bids on two different
    // buyers into one row. Generated (not written by the app), so existing rows,
    // fresh inserts and re-harvests all fold identically — the UPSERT lands on the
    // right row instead of duplicating it.
    buyerKey: text('buyer_key').generatedAlwaysAs(
      sql`btrim(regexp_replace(lower(buyer_name), '[^a-z0-9à-ÿ]+', ' ', 'g'))`,
    ),
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
    // One bid per (reference, BUYER, competitor): lets the result-crawler harvest
    // and the PV harvest race without producing duplicate rows that would double-
    // count a winner in the rebate calibration. buyer_key is in the key because a
    // portal reference alone is NOT unique — it is reused across 654 acheteurs, so
    // without the buyer two different markets sharing "05/2026" would collapse into
    // one row (buyerName overwritten, amount clobbered, isWinner sticky-OR'd). This
    // is a strict SUPERSET of the old (reference, competitor) key, so it can never
    // be violated by rows the old index already kept unique. competitor_id is
    // nullable but always set in practice; NULLs are distinct in Postgres.
    uniqueIndex('competitor_bid_reference_buyer_competitor_uniq').on(
      table.reference,
      table.buyerKey,
      table.competitorId,
    ),
    // Reference-scoped lookup for the bounded inventory bid join — replaces the
    // full `SELECT * FROM competitor_bid` (listAllBids) in the hot read path
    // once the bid table grows (heading to 150-300k rows).
    index('competitor_bid_reference_idx').on(table.reference),
    // Per-competitor rollup (all bids by concurrent X) must not seq-scan the bid
    // archive as it grows — back the competitor-scoped read with a btree index.
    index('competitor_bid_competitor_id_idx').on(table.competitorId),
    // Canonical (accent-STRIPPING) buyer fold — backs findBidsForBuyer (the
    // competitor-intel drawer's one-buyer read) so it is O(log n + matches), never a
    // whole-table scan. The expression MUST stay byte-identical to the query's WHERE
    // (intel.repository.ts) for the planner to use it. Uses the IMMUTABLE unaccent
    // wrapper (plain unaccent() is only STABLE, rejected in index expressions). The
    // hand-authored migration 0042 is the source of truth (drizzle-kit generate is
    // blocked by the 0026 snapshot collision); declared here for schema parity.
    index('competitor_bid_buyer_canon_idx').on(
      sql`btrim(regexp_replace(lower(intel.immutable_unaccent(${table.buyerName})), '[^a-z0-9]+', ' ', 'g'))`,
    ),
  ],
);
