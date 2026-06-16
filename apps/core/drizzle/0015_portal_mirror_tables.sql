CREATE SCHEMA "portal";
--> statement-breakpoint
CREATE TABLE "portal"."caution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"procedure" text,
	"category" text,
	"objet" text,
	"organisme" text,
	"deadline_at" timestamp with time zone,
	"bank_name" text,
	"intitule" text,
	"amount_mad" numeric(14, 2),
	"statut" text,
	"demande_file" text,
	"consultation_id" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal"."submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"procedure" text,
	"category" text,
	"objet" text,
	"organisme" text,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"consultation_id" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_caution_ref_deadline_amount_uniq" ON "portal"."caution" USING btree ("reference","deadline_at","amount_mad");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_submission_ref_deadline_uniq" ON "portal"."submission" USING btree ("reference","deadline_at");