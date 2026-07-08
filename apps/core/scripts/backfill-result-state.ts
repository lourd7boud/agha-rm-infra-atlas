/**
 * Backfill for the denormalized lifecycle-result columns added in migration 0041
 * (result_state / result_winner_name / result_winner_amount / result_date).
 *
 * The Clôturés / Résultats tabs read lifecycle from (deadline_at + result_state) —
 * a pure column predicate, O(page) — instead of folding the 550k-row competitor_bid
 * table in JS. This runner (re)computes those columns from the harvested bids, folded
 * to ONE result per (canonical reference, canonical buyer) market with the SAME
 * accent-stripping canonicalization the read-time BidResolver uses (canonicalReferenceKey
 * = lower + unaccent + collapse non-alnum to a single space + trim), so the SQL
 * lifecycle counts match the JS bid fold exactly.
 *
 * Idempotent: only rows whose (result_state, winner_name, winner_amount) actually
 * change are written, and updated_at is intentionally NOT bumped (so re-running does
 * not flood the /tender/inventory ?since= live-refresh delta). Safe to run repeatedly;
 * meant to run once after the 0041 deploy and again after each result harvest.
 *
 *   DATABASE_URL=... tsx apps/core/scripts/backfill-result-state.ts
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const startedAt = Date.now();
  // The fold + bulk UPDATE lives on the repository (refreshResultState) so the script,
  // the post-harvest hook, and any future caller share ONE canonicalization + SQL.
  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const rows = await repo.refreshResultState();
  console.log(
    `backfill-result-state: updated ${rows} tender row(s) in ${Date.now() - startedAt} ms`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('backfill-result-state failed:', error);
  process.exit(1);
});
