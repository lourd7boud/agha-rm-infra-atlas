CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "audit"."log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"outcome" text NOT NULL,
	"payload" jsonb
);
