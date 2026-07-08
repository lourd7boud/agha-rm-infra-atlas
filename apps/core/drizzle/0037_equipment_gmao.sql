ALTER TABLE "equipment"."equipment" ADD COLUMN "marque" text;--> statement-breakpoint
ALTER TABLE "equipment"."equipment" ADD COLUMN "modele" text;--> statement-breakpoint
ALTER TABLE "equipment"."equipment" ADD COLUMN "numero_serie" text;--> statement-breakpoint
ALTER TABLE "equipment"."equipment" ADD COLUMN "immatriculation" text;--> statement-breakpoint
CREATE TABLE "equipment"."document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reference" text,
	"issue_date" date,
	"expiry_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_document_type_check" CHECK ("equipment"."document"."type" IN ('assurance', 'carte_grise', 'controle_technique', 'visite_technique', 'autorisation', 'autre'))
);
--> statement-breakpoint
CREATE TABLE "equipment"."meter_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"reading_date" date NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"source" text DEFAULT 'manuel' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_meter_reading_unit_check" CHECK ("equipment"."meter_reading"."unit" IN ('heures', 'km'))
);
--> statement-breakpoint
CREATE TABLE "equipment"."work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ouvert' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reported_by" text,
	"opened_at" date NOT NULL,
	"completed_at" date,
	"meter_at_service" numeric(12, 2),
	"cost_mad" numeric(14, 2),
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_work_order_type_check" CHECK ("equipment"."work_order"."type" IN ('preventif', 'correctif')),
	CONSTRAINT "equipment_work_order_status_check" CHECK ("equipment"."work_order"."status" IN ('ouvert', 'en_cours', 'clos'))
);
--> statement-breakpoint
ALTER TABLE "equipment"."document" ADD CONSTRAINT "document_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment"."meter_reading" ADD CONSTRAINT "meter_reading_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment"."work_order" ADD CONSTRAINT "work_order_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_document_equipment_id_idx" ON "equipment"."document" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_document_expiry_idx" ON "equipment"."document" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "equipment_meter_reading_latest_idx" ON "equipment"."meter_reading" USING btree ("equipment_id","reading_date");--> statement-breakpoint
CREATE INDEX "equipment_work_order_equipment_id_idx" ON "equipment"."work_order" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_work_order_status_idx" ON "equipment"."work_order" USING btree ("status");
