-- P2 (scalable read architecture): denormalized classification columns.
--
-- The /tender/inventory read used to classify EVERY row per request in JS
-- (inferRegion/inferVille/inferCategory/inferSegment/inferLotCount + the hasBpu
-- jsonb test), then filter/facet/sort/paginate the whole catalogue in memory —
-- O(catalogue) per request. Pushing the deterministic classification to WRITE
-- time (these columns) lets the read filter/paginate/facet in the DB — O(page).
-- See docs/architecture/SCALABLE-READ-ARCHITECTURE.md.
--
-- All columns are NULLABLE so the migration is safe to deploy BEFORE the backfill
-- (scripts/backfill-classification.ts) completes: the read path falls back to
-- on-the-fly JS classification for any row whose column is still NULL, and the
-- write path (create / healListingBySourceUrl / updateEnrichment) fills them from
-- here on. secteur stores the FRENCH LABEL (segmentLabel(...)), matching the
-- existing facet/filter semantics exactly; category stores Travaux/Fournitures/
-- Services; region stores the region name or 'Non localisé'; has_bpu mirrors the
-- dossierExtraction.bpu length > 0 test the projected read already computes.
--
-- Hand-authored (drizzle-kit generate is blocked by a pre-existing snapshot
-- collision at 0026); applied by drizzle-kit migrate like every other migration.
-- IF NOT EXISTS keeps every statement safe to re-run.
--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "region" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "ville" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "secteur" text;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "lot_count" integer;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN IF NOT EXISTS "has_bpu" boolean;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_region_idx" ON "tender"."tender" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_category_idx" ON "tender"."tender" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_secteur_idx" ON "tender"."tender" USING btree ("secteur");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_has_bpu_idx" ON "tender"."tender" USING btree ("has_bpu");
