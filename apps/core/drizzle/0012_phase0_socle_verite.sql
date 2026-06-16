CREATE TABLE "tender"."submission_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"result" text NOT NULL,
	"montant_soumis_mad" numeric(14, 2),
	"rabais_retenu_pct" numeric(5, 2),
	"scenario_choisi" text,
	"our_rank" integer,
	"winner_amount_mad" numeric(14, 2),
	"gap_to_first_pct" numeric(7, 2),
	"motif_rejet" text,
	"lessons" jsonb,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender"."tender_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel"."competitor_bid" ADD COLUMN "tender_id" uuid;--> statement-breakpoint
ALTER TABLE "tender"."submission_outcome" ADD CONSTRAINT "submission_outcome_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender"."tender_event" ADD CONSTRAINT "tender_event_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel"."competitor_bid" ADD CONSTRAINT "competitor_bid_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE no action ON UPDATE no action;