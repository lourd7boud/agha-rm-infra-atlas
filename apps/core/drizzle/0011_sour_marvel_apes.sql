CREATE SCHEMA "supply";
--> statement-breakpoint
CREATE TABLE "supply"."purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"project_id" uuid,
	"reference" text NOT NULL,
	"objet" text NOT NULL,
	"amount_mad" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"ordered_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply"."supplier_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"reference" text NOT NULL,
	"amount_mad" numeric(14, 2) NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'recue' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply"."supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"name" text NOT NULL,
	"ice" text,
	"phone" text,
	"email" text,
	"status" text DEFAULT 'actif' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply"."purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supply"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply"."purchase_order" ADD CONSTRAINT "purchase_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply"."supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supply"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply"."supplier_invoice" ADD CONSTRAINT "supplier_invoice_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "supply"."purchase_order"("id") ON DELETE no action ON UPDATE no action;