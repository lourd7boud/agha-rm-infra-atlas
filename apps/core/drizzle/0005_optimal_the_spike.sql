CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE TABLE "finance"."caution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"tender_id" uuid,
	"project_id" uuid,
	"amount_mad" numeric(14, 2) NOT NULL,
	"bank_name" text,
	"issued_at" date NOT NULL,
	"released_at" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance"."caution" ADD CONSTRAINT "caution_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."caution" ADD CONSTRAINT "caution_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;