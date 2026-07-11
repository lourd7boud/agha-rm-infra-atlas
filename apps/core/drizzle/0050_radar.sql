-- 0050 — Radar proactif: l'avis de la société sur chaque marché en cours.
-- radar.candidate = une opinion scorée par avis (unique tender_id), rescorable,
-- avec sa ventilation par dimension, ses raisons lisibles et son cycle de vie
-- (nouveau → vu → poursuivi/écarté). Le radar transforme le catalogue de
-- dizaines de milliers d'avis en une courte liste « à traiter en priorité ».
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "radar";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS radar.candidate (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tender_id" uuid NOT NULL REFERENCES tender.tender("id"),
  "score" integer NOT NULL DEFAULT 0,
  "breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "statut" text NOT NULL DEFAULT 'nouveau',
  "scored_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radar_candidate_tender_uniq" ON radar.candidate ("tender_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_candidate_score_idx" ON radar.candidate ("score" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_candidate_statut_idx" ON radar.candidate ("statut");
