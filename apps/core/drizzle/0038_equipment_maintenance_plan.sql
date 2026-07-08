CREATE TABLE "equipment"."maintenance_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"meter_unit" text,
	"interval_meter" numeric(12, 2),
	"last_service_meter" numeric(12, 2),
	"interval_days" integer,
	"last_service_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_maintenance_plan_trigger_check" CHECK ("equipment"."maintenance_plan"."trigger_type" IN ('meter', 'temps')),
	CONSTRAINT "equipment_maintenance_plan_meter_unit_check" CHECK ("equipment"."maintenance_plan"."meter_unit" IS NULL OR "equipment"."maintenance_plan"."meter_unit" IN ('heures', 'km'))
);
--> statement-breakpoint
ALTER TABLE "equipment"."work_order" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment"."maintenance_plan" ADD CONSTRAINT "maintenance_plan_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment"."work_order" ADD CONSTRAINT "work_order_plan_id_maintenance_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "equipment"."maintenance_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_maintenance_plan_equipment_id_idx" ON "equipment"."maintenance_plan" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_work_order_plan_id_idx" ON "equipment"."work_order" USING btree ("plan_id");
