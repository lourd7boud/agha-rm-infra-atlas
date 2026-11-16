ALTER TABLE "project"."ordre_service" ADD COLUMN "arret_scope" text;
--> statement-breakpoint
ALTER TABLE "project"."ordre_service" ADD COLUMN "reprise_arret_id" text;
--> statement-breakpoint
ALTER TABLE "project"."ordre_service" ADD COLUMN "calendar_effect_applied_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "project"."ordre_service" ADD CONSTRAINT "ods_arret_scope_check" CHECK ("arret_scope" IS NULL OR "arret_scope" IN ('total', 'partiel'));
