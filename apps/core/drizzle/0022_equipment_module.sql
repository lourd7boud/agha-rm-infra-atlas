CREATE SCHEMA "equipment";
--> statement-breakpoint
CREATE TABLE "equipment"."assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assigned_at" date NOT NULL,
	"expected_return_at" date,
	"returned_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment"."equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'disponible' NOT NULL,
	"acquisition_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_status_check" CHECK ("equipment"."equipment"."status" IN ('disponible', 'assignee', 'hors_service'))
);
--> statement-breakpoint
ALTER TABLE "equipment"."assignment" ADD CONSTRAINT "assignment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment"."assignment" ADD CONSTRAINT "assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_assignment_equipment_id_idx" ON "equipment"."assignment" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_assignment_project_id_idx" ON "equipment"."assignment" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_company_name_uniq" ON "equipment"."equipment" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "equipment_status_idx" ON "equipment"."equipment" USING btree ("status");