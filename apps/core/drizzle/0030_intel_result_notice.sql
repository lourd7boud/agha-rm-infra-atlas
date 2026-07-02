-- intel.result_notice — the permanent archive of published result/PV notices.
--
-- The 129k-notice historical backfill (35 616 résultats définitifs + 93 754
-- extraits de PV on the portal) splits into two independent pipelines:
--   ACQUISITION  crawl + download + OCR → this table (network + CPU, free,
--                runs at full speed regardless of any LLM budget);
--   INTERPRETATION  ocr_text → competitor_bid rows (deterministic regex
--                first, LLM fallback, bounded by the daily budget).
-- id_avis is the portal's own notice id — the idempotency key that makes the
-- backfill resumable and re-walked listing pages free.
--
-- Purely additive: one new table, two indexes, no existing object touched.
--> statement-breakpoint

CREATE TABLE "intel"."result_notice" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "annonce_type" text NOT NULL,
  "id_avis" text NOT NULL,
  "source_url" text,
  "reference" text,
  "buyer_name" text,
  "ocr_text" text,
  "bytes_size" numeric(12, 0),
  "status" text NOT NULL DEFAULT 'acquired',
  "error" text,
  "acquired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "interpreted_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "result_notice_id_avis_uniq" ON "intel"."result_notice" ("id_avis");--> statement-breakpoint
CREATE INDEX "result_notice_status_idx" ON "intel"."result_notice" ("status");
