CREATE TABLE "supply"."purchase_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text,
	"unit_price_mad" numeric(14, 2) NOT NULL,
	"line_total_mad" numeric(14, 2) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply"."purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "supply"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_purchase_order_line_order_id_idx" ON "supply"."purchase_order_line" USING btree ("purchase_order_id");