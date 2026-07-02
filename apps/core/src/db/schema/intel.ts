// pg schema: intel — competitor register and harvested competitor bids.
import {
  boolean,
  date,
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
  ],
);
