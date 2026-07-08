-- Stage 2 of the lifecycle read model: denormalize the harvested RESULT onto the
-- tender row so the lifecycle FILTER + FACET (the Clôturés / Résultats tabs) become
-- pure column predicates — O(page) — instead of a whole-catalogue JS fold over the
-- ~73k deduped result markets (the O(catalogue) path the tabs used before).
--
-- Lifecycle at read time = deadline_at (en_cours vs past) + these columns (the past
-- split), matching the read-time BidResolver exactly:
--   deadline_at >= now                                → En cours
--   deadline_at <  now AND result_state IS NULL       → Clôturé  (no harvested result)
--   deadline_at <  now AND result_state = 'attribue'  → Attribué (a winner published)
--   deadline_at <  now AND result_state = 'infructueux' → Infructueux (bids, no winner)
--
-- Populated by scripts/backfill-result-state.ts (canonical ref+buyer match, the same
-- fold the BidResolver uses) and refreshed after each result harvest. All NULLABLE:
-- safe to deploy BEFORE the backfill — the read then shows past-deadline rows as
-- Clôturé until the backfill lands, at which point the counts match the bid fold
-- exactly. result_winner_name/amount let the list render "Fournisseur retenu" with
-- zero bid access.
--
-- Hand-authored (drizzle-kit generate is blocked by the pre-existing 0026 snapshot
-- collision); applied by drizzle-kit migrate like every other migration. IF NOT
-- EXISTS keeps it safe to re-run. tender.tender is ~97k rows → ADD COLUMN (no
-- default backfill) is instant; the index build is sub-second.
--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "result_state" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "result_winner_name" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "result_winner_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "result_date" date;--> statement-breakpoint
-- Backs the Clôturés/Résultats page filter (deadline_at < now AND result_state <op>).
-- The whole-catalogue FILTER-count facet seq-scans regardless; this index serves the
-- paginated page WHERE.
CREATE INDEX IF NOT EXISTS "tender_result_state_idx" ON "tender"."tender" USING btree ("result_state");
