CREATE SCHEMA "stock";
--> statement-breakpoint
CREATE TABLE "stock"."depot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock"."material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"code" text NOT NULL,
	"designation" text NOT NULL,
	"unit" text NOT NULL,
	"category" text,
	"unit_cost_mad" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock"."stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_mad" numeric(14, 2),
	"from_depot_id" uuid,
	"to_depot_id" uuid,
	"project_id" uuid,
	"reference" text,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock"."stock_movement" ADD CONSTRAINT "stock_movement_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "stock"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock"."stock_movement" ADD CONSTRAINT "stock_movement_from_depot_id_depot_id_fk" FOREIGN KEY ("from_depot_id") REFERENCES "stock"."depot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock"."stock_movement" ADD CONSTRAINT "stock_movement_to_depot_id_depot_id_fk" FOREIGN KEY ("to_depot_id") REFERENCES "stock"."depot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock"."stock_movement" ADD CONSTRAINT "stock_movement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_depot_company_name_uniq" ON "stock"."depot" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_material_company_code_uniq" ON "stock"."material" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "stock_movement_material_id_idx" ON "stock"."stock_movement" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "stock_movement_from_depot_id_idx" ON "stock"."stock_movement" USING btree ("from_depot_id");--> statement-breakpoint
CREATE INDEX "stock_movement_to_depot_id_idx" ON "stock"."stock_movement" USING btree ("to_depot_id");--> statement-breakpoint
CREATE INDEX "stock_movement_project_id_idx" ON "stock"."stock_movement" USING btree ("project_id");