CREATE TABLE "finance"."expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"project_id" uuid,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"amount_mad" numeric(14, 2) NOT NULL,
	"method" text,
	"reference" text,
	"supplier_id" uuid,
	"spent_at" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"project_id" uuid,
	"label" text NOT NULL,
	"payer_name" text,
	"amount_mad" numeric(14, 2) NOT NULL,
	"method" text DEFAULT 'virement' NOT NULL,
	"transfer_reference" text,
	"bank_name" text,
	"paid_at" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance"."expense" ADD CONSTRAINT "expense_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."expense" ADD CONSTRAINT "expense_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supply"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "payment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_category_idx" ON "finance"."expense" USING btree ("category");--> statement-breakpoint
CREATE INDEX "expense_project_id_idx" ON "finance"."expense" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "expense_supplier_id_idx" ON "finance"."expense" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "payment_project_id_idx" ON "finance"."payment" USING btree ("project_id");