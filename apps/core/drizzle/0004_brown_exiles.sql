CREATE SCHEMA "project";
--> statement-breakpoint
CREATE TABLE "project"."project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"tender_id" uuid,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"buyer_name" text NOT NULL,
	"montant_marche_mad" numeric(14, 2) NOT NULL,
	"ordre_service_date" date,
	"delai_mois" numeric(4, 1),
	"status" text DEFAULT 'preparation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."situation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"period_end" date NOT NULL,
	"montant_cumule_mad" numeric(14, 2) NOT NULL,
	"montant_periode_mad" numeric(14, 2) NOT NULL,
	"retenue_garantie_mad" numeric(14, 2) NOT NULL,
	"net_a_payer_mad" numeric(14, 2) NOT NULL,
	"avancement_pct" numeric(5, 2) NOT NULL,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project"."project" ADD CONSTRAINT "project_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."situation" ADD CONSTRAINT "situation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;