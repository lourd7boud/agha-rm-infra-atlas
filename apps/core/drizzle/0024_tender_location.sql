ALTER TABLE "tender"."tender" ADD COLUMN "location" text;--> statement-breakpoint
-- Back-seed location from the legacy buyer_name: the OLD positional parser stored
-- the lieu d'exécution in buyer_name. Preserving it means rows that scroll off the
-- listing before being re-crawled keep a location instead of going NULL; the heal
-- overwrites it with the clean panelBlocLieuxExec value when a re-crawl captures one.
UPDATE "tender"."tender" SET "location" = "buyer_name" WHERE "location" IS NULL;