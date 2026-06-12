CREATE SCHEMA "people";
--> statement-breakpoint
CREATE TABLE "people"."assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"full_name" text NOT NULL,
	"cin" text,
	"metier" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'actif' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people"."assignment" ADD CONSTRAINT "assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "people"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."assignment" ADD CONSTRAINT "assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;