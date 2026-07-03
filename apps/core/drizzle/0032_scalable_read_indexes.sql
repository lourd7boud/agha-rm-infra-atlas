-- P1 (scalable read architecture): hot-column btree indexes.
--
-- Before this, tender.tender carried ONLY a partial unique index on source_url,
-- so every list/order/facet/dedup query was a full sequential scan of the whole
-- table (incl. the heavy `raw` jsonb) plus an in-memory Sort. These back the
-- datao-style read path — index-ordered pagination, facet filters, and the
-- create() duplicate probe. See docs/architecture/SCALABLE-READ-ARCHITECTURE.md.
--
-- Hand-authored (drizzle-kit generate is blocked by a pre-existing snapshot
-- collision at 0026); applied by drizzle-kit migrate like every other migration.
-- IF NOT EXISTS keeps it safe to re-run and safe against any manually-created
-- index on the production box. Small table (~5k rows) → each CREATE is sub-second
-- and runs inside the migration transaction (no CONCURRENTLY).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_created_at_idx" ON "tender"."tender" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_deadline_at_idx" ON "tender"."tender" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_procedure_idx" ON "tender"."tender" USING btree ("procedure");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_pipeline_state_idx" ON "tender"."tender" USING btree ("pipeline_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_buyer_name_idx" ON "tender"."tender" USING btree ("buyer_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_reference_buyer_idx" ON "tender"."tender" USING btree ("reference","buyer_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_bid_reference_idx" ON "intel"."competitor_bid" USING btree ("reference");
