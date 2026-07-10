-- 0047 — Le marché devient NOTRE marché, le terrain devient saisissable.
--
-- 1. project.project : mode d'obtention du marché (adjudicataire direct,
--    bon de commande ≤500k DH [décret 2-22-431 art. 91], sous-traitance,
--    groupement conjoint/solidaire, marché privé) + payload `acquisition`
--    (titulaire principal, membres du groupement, client privé…).
-- 2. project.daily_log : le rapport de chantier s'enrichit (heures, visites,
--    note d'avancement, photos liées au store project_asset).
-- 3. finance.expense : justificatif photo (project_asset) + saisi_par — la
--    dépense terrain la plus petite a une trace et un reçu.
-- 4. Nouvelles tables terrain : matériel utilisé, consommations matériaux,
--    attachements terrain (quantités réalisées par ligne du bordereau, à
--    intégrer dans les métrés côté administratif).
--> statement-breakpoint
ALTER TABLE project.project
  ADD COLUMN IF NOT EXISTS mode_obtention text NOT NULL DEFAULT 'ao_direct';
--> statement-breakpoint
ALTER TABLE project.project
  ADD COLUMN IF NOT EXISTS acquisition jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE project.daily_log
  ADD COLUMN IF NOT EXISTS heures_travail numeric(4,1);
--> statement-breakpoint
ALTER TABLE project.daily_log
  ADD COLUMN IF NOT EXISTS visites text;
--> statement-breakpoint
ALTER TABLE project.daily_log
  ADD COLUMN IF NOT EXISTS avancement text;
--> statement-breakpoint
ALTER TABLE project.daily_log
  ADD COLUMN IF NOT EXISTS photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE finance.expense
  ADD COLUMN IF NOT EXISTS justificatif_asset_id uuid REFERENCES project.project_asset(id);
--> statement-breakpoint
ALTER TABLE finance.expense
  ADD COLUMN IF NOT EXISTS saisi_par text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project.chantier_materiel (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES project.project("id"),
  "date" date NOT NULL,
  "engin" text NOT NULL,
  "equipment_id" uuid,
  "regime" text NOT NULL DEFAULT 'propre',
  "heures_utilisation" numeric(6,1),
  "carburant_l" numeric(8,1),
  "cout_carburant_mad" numeric(12,2) NOT NULL DEFAULT 0,
  "cout_location_mad" numeric(12,2) NOT NULL DEFAULT 0,
  "note" text,
  "saisi_par" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chantier_materiel_project_date_idx"
  ON project.chantier_materiel ("project_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project.chantier_consommation (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES project.project("id"),
  "date" date NOT NULL,
  "article" text NOT NULL,
  "unite" text NOT NULL DEFAULT 'u',
  "quantite" numeric(12,3) NOT NULL,
  "prix_unitaire_mad" numeric(12,2),
  "cout_mad" numeric(12,2) NOT NULL DEFAULT 0,
  "fournisseur" text,
  "bon_livraison" text,
  "note" text,
  "saisi_par" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chantier_consommation_project_date_idx"
  ON project.chantier_consommation ("project_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project.chantier_attachement (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES project.project("id"),
  "date" date NOT NULL,
  "ligne_id" text NOT NULL,
  "numero_prix" text,
  "designation" text NOT NULL,
  "unite" text NOT NULL,
  "quantite" numeric(14,3) NOT NULL,
  "note" text,
  "statut" text NOT NULL DEFAULT 'saisi',
  "saisi_par" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chantier_attachement_project_date_idx"
  ON project.chantier_attachement ("project_id", "date");
