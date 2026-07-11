-- 0049 — Résultats des avis d'achat (intelligence concurrents).
-- Le portail publie 300k+ résultats de bons de commande: gagnant, montant
-- TTC, nombre de devis reçus, ou « infructueux ». bdc.resultat en est le
-- miroir incrémental; le lien avis_id est posé quand (référence, acheteur)
-- matche un avis suivi — leçon lifecycle: les références se répètent entre
-- acheteurs, la clé naturelle est TOUJOURS scopée acheteur.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bdc.resultat (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference" text NOT NULL,
  "objet" text NOT NULL,
  "acheteur" text NOT NULL,
  "date_resultat" timestamp with time zone,
  "nb_devis" integer,
  "issue" text NOT NULL DEFAULT 'infructueux',
  "attributaire" text,
  "montant_ttc" numeric(14,2),
  "avis_id" uuid,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bdc_resultat_ref_acheteur_date_uniq"
  ON bdc.resultat ("reference", "acheteur", "date_resultat");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bdc_resultat_acheteur_idx" ON bdc.resultat ("acheteur");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bdc_resultat_attributaire_idx" ON bdc.resultat ("attributaire");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bdc_resultat_date_idx" ON bdc.resultat ("date_resultat" DESC);
