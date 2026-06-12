CREATE SCHEMA "watch";
--> statement-breakpoint
CREATE TABLE "watch"."portal_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"changed" boolean NOT NULL,
	"parsed_ok" boolean DEFAULT false NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"object_key" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
