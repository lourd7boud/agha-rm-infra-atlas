CREATE SCHEMA "sales";
--> statement-breakpoint
CREATE TABLE "sales"."client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"name" text NOT NULL,
	"ice" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"status" text DEFAULT 'actif' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."delivery_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text,
	"order_index" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "sales"."delivery_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"quote_id" uuid,
	"reference" text NOT NULL,
	"delivery_date" date NOT NULL,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text,
	"unit_price_mad" numeric(14, 2) NOT NULL,
	"line_total_mad" numeric(14, 2) NOT NULL,
	"order_index" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "sales"."invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"quote_id" uuid,
	"reference" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"total_ht_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tva_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"total_ttc_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."quote_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text,
	"unit_price_mad" numeric(14, 2) NOT NULL,
	"line_total_mad" numeric(14, 2) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"reference" text NOT NULL,
	"objet" text,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"quote_date" date NOT NULL,
	"valid_until" date,
	"total_ht_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tva_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"total_ttc_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."delivery_line" ADD CONSTRAINT "delivery_line_delivery_note_id_delivery_note_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "sales"."delivery_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."delivery_note" ADD CONSTRAINT "delivery_note_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "sales"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."delivery_note" ADD CONSTRAINT "delivery_note_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."delivery_note" ADD CONSTRAINT "delivery_note_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "sales"."quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "sales"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "sales"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."invoice" ADD CONSTRAINT "invoice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."invoice" ADD CONSTRAINT "invoice_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "sales"."quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote_line" ADD CONSTRAINT "quote_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "sales"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote" ADD CONSTRAINT "quote_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "sales"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote" ADD CONSTRAINT "quote_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_client_company_name_uniq" ON "sales"."client" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "sales_delivery_line_delivery_note_id_idx" ON "sales"."delivery_line" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_note_company_reference_uniq" ON "sales"."delivery_note" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "sales_delivery_note_client_id_idx" ON "sales"."delivery_note" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_line_invoice_id_idx" ON "sales"."invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_company_reference_uniq" ON "sales"."invoice" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "sales_invoice_client_id_idx" ON "sales"."invoice" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sales_quote_line_quote_id_idx" ON "sales"."quote_line" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quote_company_reference_uniq" ON "sales"."quote" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "sales_quote_client_id_idx" ON "sales"."quote" USING btree ("client_id");