-- 0052 — Auditable autonomous pricing runs, evidence and verified learning.
CREATE TABLE bdc.pricing_run (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "avis_id" uuid NOT NULL REFERENCES bdc.avis("id") ON DELETE CASCADE,
  "idempotency_key" text NOT NULL,
  "content_hash" text NOT NULL,
  "actor_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "stage" text NOT NULL DEFAULT 'analyse',
  "progress_pct" integer NOT NULL DEFAULT 0,
  "requested_markup_pct" numeric(6,2) NOT NULL DEFAULT 15,
  "calibration_version" text NOT NULL,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bdc_pricing_run_avis_idempotency_uniq"
  ON bdc.pricing_run ("avis_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "bdc_pricing_run_avis_created_idx"
  ON bdc.pricing_run ("avis_id", "created_at");
--> statement-breakpoint
CREATE INDEX "bdc_pricing_run_status_idx" ON bdc.pricing_run ("status");
--> statement-breakpoint
CREATE TABLE bdc.pricing_line_decision (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES bdc.pricing_run("id") ON DELETE CASCADE,
  "line_idx" integer NOT NULL,
  "decision" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bdc_pricing_line_run_idx_uniq"
  ON bdc.pricing_line_decision ("run_id", "line_idx");
--> statement-breakpoint
CREATE TABLE bdc.price_observation (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "designation" text NOT NULL,
  "category" text NOT NULL,
  "unit" text NOT NULL,
  "unit_price_ht_mad" numeric(16,4) NOT NULL,
  "region" text,
  "observed_at" timestamp with time zone NOT NULL,
  "source_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_url" text,
  "evidence_hash" text NOT NULL,
  "verified" boolean NOT NULL DEFAULT false,
  "reliability" numeric(5,4) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bdc_price_observation_hash_uniq"
  ON bdc.price_observation ("evidence_hash");
--> statement-breakpoint
CREATE INDEX "bdc_price_observation_category_unit_date_idx"
  ON bdc.price_observation ("category", "unit", "observed_at");
--> statement-breakpoint
CREATE TABLE bdc.pricing_feedback (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES bdc.pricing_run("id") ON DELETE CASCADE,
  "line_idx" integer,
  "kind" text NOT NULL,
  "unit_price_ht_mad" numeric(16,4),
  "actual_cost_ht_mad" numeric(16,4),
  "winning_amount_ht_mad" numeric(16,4),
  "source_ref" text,
  "source_url" text,
  "verified" boolean NOT NULL DEFAULT false,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "bdc_pricing_feedback_verified_date_idx"
  ON bdc.pricing_feedback ("verified", "created_at");
--> statement-breakpoint
CREATE TABLE bdc.pricing_calibration (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bdc_pricing_calibration_version_uniq"
  ON bdc.pricing_calibration ("version");
--> statement-breakpoint
CREATE INDEX "bdc_pricing_calibration_active_idx"
  ON bdc.pricing_calibration ("active", "created_at");
