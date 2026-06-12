CREATE SCHEMA "intel";
--> statement-breakpoint
CREATE TABLE "intel"."competitor_bid" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"buyer_name" text NOT NULL,
	"bidder_name" text NOT NULL,
	"competitor_id" uuid,
	"amount_mad" numeric(14, 2),
	"is_winner" boolean DEFAULT false NOT NULL,
	"result_date" date,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel"."competitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel"."competitor_bid" ADD CONSTRAINT "competitor_bid_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "intel"."competitor"("id") ON DELETE no action ON UPDATE no action;