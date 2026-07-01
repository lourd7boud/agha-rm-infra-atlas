-- Phase 3 (datao parity): missing atomic dimensions on tender.tender.
--
-- Datao surfaces these four fields on the tender detail page and in Cube.js
-- filters (isSimplified, rectified, milestoneCount, attributedAt). ATLAS
-- currently derives similar signals from strings/JSONB; extracting them into
-- typed columns lets the FTS trigger, the inventory facets, and future
-- pre-aggregations run without JSONB path lookups on the hot path.
--
-- All four are nullable / defaulted so legacy rows stay valid; the extraction
-- service back-fills the values as it re-processes each tender.
--> statement-breakpoint

ALTER TABLE "tender"."tender" ADD COLUMN "is_simplified" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN "rectified" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN "milestones_count" integer;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN "attributed_at" timestamp with time zone;
