-- 0048 — Bons de commande (avis d'achat du module /bdc du portail PMMP).
-- Le portail publie les demandes d'achat par bon de commande avec leurs
-- ARTICLES STRUCTURÉS (désignation, spécifications, unité, quantité, TVA):
-- bdc.avis mirrore cette donnée; bdc.reponse est l'espace de travail de
-- l'agent chargé (prix proposés par article, marge, totaux, statut).
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "bdc";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bdc.avis (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "portal_id" integer NOT NULL,
  "reference" text NOT NULL,
  "objet" text NOT NULL,
  "acheteur" text NOT NULL,
  "statut" text NOT NULL DEFAULT 'en_cours',
  "date_publication" timestamp with time zone,
  "date_limite" timestamp with time zone,
  "lieu" text,
  "categorie" text,
  "nature_prestation" text,
  "pieces" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "articles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "detail_fetched_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bdc_avis_portal_id_uniq" ON bdc.avis ("portal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bdc_avis_statut_limite_idx" ON bdc.avis ("statut", "date_limite");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bdc.reponse (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "avis_id" uuid NOT NULL REFERENCES bdc.avis("id"),
  "statut" text NOT NULL DEFAULT 'brouillon',
  "marge_pct" numeric(5,2) NOT NULL DEFAULT 15,
  "lignes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "total_ht" numeric(14,2) NOT NULL DEFAULT 0,
  "total_tva" numeric(14,2) NOT NULL DEFAULT 0,
  "total_ttc" numeric(14,2) NOT NULL DEFAULT 0,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bdc_reponse_avis_uniq" ON bdc.reponse ("avis_id");
