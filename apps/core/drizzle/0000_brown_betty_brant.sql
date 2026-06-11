CREATE SCHEMA "tender";
--> statement-breakpoint
CREATE SCHEMA "vault";
--> statement-breakpoint
CREATE TABLE "tender"."buyer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"buyer_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender"."tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"reference" text NOT NULL,
	"buyer_id" uuid,
	"buyer_name" text NOT NULL,
	"procedure" text NOT NULL,
	"objet" text NOT NULL,
	"estimation_mad" numeric(14, 2),
	"caution_provisoire_mad" numeric(14, 2),
	"deadline_at" timestamp with time zone NOT NULL,
	"pipeline_state" text DEFAULT 'detected' NOT NULL,
	"source_url" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault"."document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"reference" text,
	"bucket" text,
	"object_key" text,
	"sha256" text,
	"mime" text,
	"issued_at" date,
	"expires_at" date,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD CONSTRAINT "tender_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "tender"."buyer"("id") ON DELETE no action ON UPDATE no action;