ALTER TABLE "equipment"."equipment" ADD COLUMN "acquisition_cost_mad" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "equipment"."equipment" ADD COLUMN "depreciation_months" integer;--> statement-breakpoint
ALTER TABLE "equipment"."equipment" ADD COLUMN "salvage_value_mad" numeric(14, 2);--> statement-breakpoint
CREATE TABLE "equipment"."inspection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"inspection_date" date NOT NULL,
	"inspected_by" text,
	"result" text DEFAULT 'conforme' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_inspection_type_check" CHECK ("equipment"."inspection"."type" IN ('avant_affectation', 'retour_chantier', 'periodique', 'securite')),
	CONSTRAINT "equipment_inspection_result_check" CHECK ("equipment"."inspection"."result" IN ('conforme', 'reserves', 'non_conforme'))
);
--> statement-breakpoint
CREATE TABLE "equipment"."inspection_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_inspection_item_status_check" CHECK ("equipment"."inspection_item"."status" IN ('ok', 'defaut', 'na'))
);
--> statement-breakpoint
ALTER TABLE "equipment"."inspection" ADD CONSTRAINT "inspection_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment"."inspection_item" ADD CONSTRAINT "inspection_item_inspection_id_inspection_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "equipment"."inspection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_inspection_equipment_id_idx" ON "equipment"."inspection" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_item_inspection_id_idx" ON "equipment"."inspection_item" USING btree ("inspection_id");
