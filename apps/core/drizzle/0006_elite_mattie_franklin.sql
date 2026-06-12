CREATE TABLE "project"."daily_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"effectifs" integer NOT NULL,
	"travaux_realises" text NOT NULL,
	"materiel" text,
	"meteo" text,
	"blocages" text,
	"incidents_securite" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project"."daily_log" ADD CONSTRAINT "daily_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;