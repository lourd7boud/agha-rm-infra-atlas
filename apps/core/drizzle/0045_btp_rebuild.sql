-- BTP projects module rebuild — replaces the first-pass execution tables with a
-- faithful port of the source construction-management app (btpdb). The previous
-- tables' contents were themselves migrated from btpdb, so dropping them loses
-- nothing that the (re-runnable) btpdb migration script cannot restore.
-- Pre-existing tables consumed by other modules (project.project, situation,
-- daily_log, task) are only extended, never dropped.
DROP TABLE IF EXISTS "project"."decompte_revision" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."decompte" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."metre" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."periode" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."bordereau" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."project_revision_config" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."revision_index" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project"."revision_formula" CASCADE;--> statement-breakpoint

-- Fiche marché: administrative identity, budget imputation, arrêts, corbeille.
ALTER TABLE "project"."project" DROP COLUMN IF EXISTS "delai_execution_jours";--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "rc" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "cb" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "cnss" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "patente" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "programme" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "projet_libelle" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "ligne_budgetaire" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "chapitre" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "arrets" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "legacy_project_id" uuid;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint

-- Avenant: full BTP registre (CCAG-T art. 51/52/54). Existing rows were created
-- through the "approved-only" legacy shape — mark them approuve.
ALTER TABLE "project"."avenant" ALTER COLUMN "approved_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "reference" text;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "type_avenant" text NOT NULL DEFAULT 'modification';--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "statut" text NOT NULL DEFAULT 'brouillon';--> statement-breakpoint
UPDATE "project"."avenant" SET "statut" = 'approuve' WHERE "approved_at" IS NOT NULL AND "statut" = 'brouillon';--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "date_avenant" date;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "date_notification" date;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "date_approbation" date;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "montant_initial_mad" numeric(14,2);--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "montant_nouveau_mad" numeric(14,2);--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "pourcentage_variation" numeric(8,4);--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "modifications" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "prix_nouveaux" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "observations" text;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();--> statement-breakpoint

-- Bordereau des prix (BPU).
CREATE TABLE IF NOT EXISTS "project"."bordereau" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"reference" text,
	"designation" text,
	"lignes" jsonb NOT NULL DEFAULT '[]',
	"montant_total_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bordereau_project_id_idx" ON "project"."bordereau" ("project_id");--> statement-breakpoint

-- Périodes (métré N°X wrappers).
CREATE TABLE IF NOT EXISTS "project"."periode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"numero" integer NOT NULL,
	"libelle" text,
	"date_debut" date,
	"date_fin" date,
	"taux_tva" numeric(5,2) NOT NULL DEFAULT 20,
	"taux_retenue" numeric(5,2) NOT NULL DEFAULT 10,
	"is_decompte_dernier" boolean NOT NULL DEFAULT false,
	"statut" text NOT NULL DEFAULT 'en_cours',
	"observations" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "periode_project_id_idx" ON "project"."periode" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "periode_project_numero_uq" ON "project"."periode" ("project_id","numero") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- Métrés (one row per bordereau line × période, hierarchical measurements).
CREATE TABLE IF NOT EXISTS "project"."metre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"periode_id" uuid NOT NULL REFERENCES "project"."periode"("id"),
	"bordereau_ligne_id" text NOT NULL,
	"designation_bordereau" text,
	"unite" text,
	"sections" jsonb NOT NULL DEFAULT '[]',
	"sous_sections" jsonb NOT NULL DEFAULT '[]',
	"lignes" jsonb NOT NULL DEFAULT '[]',
	"total_partiel" numeric(15,4) NOT NULL DEFAULT 0,
	"total_cumule" numeric(15,4) NOT NULL DEFAULT 0,
	"quantite_bordereau" numeric(15,4) NOT NULL DEFAULT 0,
	"pourcentage_realisation" numeric(8,2) NOT NULL DEFAULT 0,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metre_project_id_idx" ON "project"."metre" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metre_periode_id_idx" ON "project"."metre" ("periode_id");--> statement-breakpoint

-- Décomptes (auto-generated from métrés; persists the full récapitulatif).
CREATE TABLE IF NOT EXISTS "project"."decompte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"periode_id" uuid REFERENCES "project"."periode"("id"),
	"numero" integer NOT NULL,
	"date_decompte" date,
	"lignes" jsonb NOT NULL DEFAULT '[]',
	"taux_tva" numeric(5,2) NOT NULL DEFAULT 20,
	"total_ht_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"revision_montant_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"montant_tva_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"total_ttc_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"depenses_anterieures_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"decomptes_precedents_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"retenue_garantie_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"montant_acompte_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"is_dernier" boolean NOT NULL DEFAULT false,
	"statut" text NOT NULL DEFAULT 'draft',
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decompte_project_id_idx" ON "project"."decompte" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decompte_project_periode_uq" ON "project"."decompte" ("project_id","periode_id") WHERE "periode_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decompte_project_numero_uq" ON "project"."decompte" ("project_id","numero") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- Révision des prix.
CREATE TABLE IF NOT EXISTS "project"."revision_formula" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fixed_part" numeric(6,4) NOT NULL DEFAULT 0.15,
	"weights" jsonb NOT NULL DEFAULT '{}',
	"is_default" boolean NOT NULL DEFAULT false,
	"is_public" boolean NOT NULL DEFAULT true,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."revision_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_date" date NOT NULL UNIQUE,
	"index_values" jsonb NOT NULL DEFAULT '{}',
	"source" text,
	"notes" text,
	"status" text NOT NULL DEFAULT 'provisoire',
	"created_by" text,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."revision_index_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_date" date,
	"action" text NOT NULL,
	"actor_sub" text,
	"actor_name" text,
	"changes" jsonb,
	"source" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revision_index_audit_month_idx" ON "project"."revision_index_audit" ("month_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."project_revision_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL UNIQUE REFERENCES "project"."project"("id"),
	"formula_id" uuid REFERENCES "project"."revision_formula"("id"),
	"base_indexes" jsonb NOT NULL DEFAULT '{}',
	"base_date" date,
	"is_enabled" boolean NOT NULL DEFAULT true,
	"notes" text,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."decompte_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decompte_id" uuid NOT NULL UNIQUE REFERENCES "project"."decompte"("id"),
	"montant_a_reviser" numeric(15,2),
	"coefficient_applique" numeric(12,6),
	"montant_revision" numeric(15,2),
	"calculation_details" jsonb,
	"formula_snapshot" jsonb,
	"base_indexes_snapshot" jsonb,
	"status" text NOT NULL DEFAULT 'calculated',
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decompte_revision_decompte_id_idx" ON "project"."decompte_revision" ("decompte_id");--> statement-breakpoint

-- Ordres de service.
CREATE TABLE IF NOT EXISTS "project"."ordre_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"numero" integer NOT NULL,
	"reference" text,
	"type" text NOT NULL DEFAULT 'commencement',
	"objet" text NOT NULL,
	"description" text,
	"motif" text,
	"date_emission" date,
	"date_effet" date,
	"date_fin" date,
	"delai_jours" integer,
	"impact_financier_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"impact_delai_jours" integer NOT NULL DEFAULT 0,
	"emetteur" text,
	"emetteur_fonction" text,
	"destinataire" text,
	"avenant_id" uuid REFERENCES "project"."avenant"("id"),
	"statut" text NOT NULL DEFAULT 'brouillon',
	"date_notification" date,
	"date_accuse_reception" date,
	"accuse_par" text,
	"observations_destinataire" text,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ods_project_id_idx" ON "project"."ordre_service" ("project_id");--> statement-breakpoint

-- Pénalités / cautions / retenues.
CREATE TABLE IF NOT EXISTS "project"."penalite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"type" text NOT NULL DEFAULT 'retard',
	"date_debut" date,
	"date_fin" date,
	"nombre_jours" integer NOT NULL DEFAULT 0,
	"taux" numeric(8,5) NOT NULL DEFAULT 0.001,
	"base_calcul_mad" numeric(15,2),
	"montant_penalite_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"plafond_pourcentage" numeric(5,2) NOT NULL DEFAULT 10,
	"montant_plafond_mad" numeric(15,2),
	"montant_applique_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"statut" text NOT NULL DEFAULT 'calculee',
	"reference_notification" text,
	"date_notification" date,
	"motif" text,
	"observations" text,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "penalite_project_id_idx" ON "project"."penalite" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."caution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"type" text NOT NULL,
	"montant_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"pourcentage" numeric(5,2),
	"base_calcul_mad" numeric(15,2),
	"organisme" text,
	"reference_organisme" text,
	"date_emission" date,
	"date_expiration" date,
	"date_mainlevee" date,
	"statut" text NOT NULL DEFAULT 'active',
	"observations" text,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caution_project_id_idx" ON "project"."caution" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."retenue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"caution_id" uuid REFERENCES "project"."caution"("id"),
	"decompte_id" uuid REFERENCES "project"."decompte"("id"),
	"decompte_numero" integer,
	"montant_decompte_mad" numeric(15,2),
	"taux_retenue" numeric(5,2) NOT NULL DEFAULT 7,
	"montant_retenue_mad" numeric(15,2) NOT NULL DEFAULT 0,
	"montant_cumule_mad" numeric(15,2),
	"liberee" boolean NOT NULL DEFAULT false,
	"date_liberation" date,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retenue_project_id_idx" ON "project"."retenue" ("project_id");--> statement-breakpoint

-- Circuit de validation.
CREATE TABLE IF NOT EXISTS "project"."approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"document_type" text NOT NULL,
	"document_id" text,
	"document_reference" text,
	"status" text NOT NULL DEFAULT 'en_attente',
	"current_step" integer NOT NULL DEFAULT 1,
	"total_steps" integer NOT NULL DEFAULT 1,
	"priority" text NOT NULL DEFAULT 'normal',
	"due_date" date,
	"note" text,
	"montant_mad" numeric(15,2),
	"requested_by" text,
	"requested_by_name" text,
	"submitted_at" timestamp with time zone NOT NULL DEFAULT now(),
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_request_project_id_idx" ON "project"."approval_request" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."approval_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "project"."approval_request"("id"),
	"step_order" integer NOT NULL,
	"step_label" text NOT NULL,
	"role" text,
	"status" text NOT NULL DEFAULT 'en_attente',
	"decided_by" text,
	"decided_by_name" text,
	"decision_date" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_step_request_id_idx" ON "project"."approval_step" ("request_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."approval_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "project"."approval_request"("id"),
	"step_id" uuid REFERENCES "project"."approval_step"("id"),
	"action" text NOT NULL,
	"actor_sub" text,
	"actor_name" text,
	"comment" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_history_request_id_idx" ON "project"."approval_history" ("request_id");--> statement-breakpoint

-- Photothèque / PV / documents.
CREATE TABLE IF NOT EXISTS "project"."photo_album" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"name" text NOT NULL,
	"description" text,
	"color" text NOT NULL DEFAULT '#22d3ee',
	"icon" text NOT NULL DEFAULT 'folder',
	"sort_order" integer NOT NULL DEFAULT 0,
	"periode_id" uuid REFERENCES "project"."periode"("id"),
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_album_project_id_idx" ON "project"."photo_album" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project"."project_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "project"."project"("id"),
	"type" text NOT NULL,
	"file_name" text,
	"original_name" text,
	"mime_type" text,
	"file_size" integer,
	"storage_key" text,
	"sha256" text,
	"album_id" uuid REFERENCES "project"."photo_album"("id"),
	"metadata" jsonb NOT NULL DEFAULT '{}',
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_asset_project_id_idx" ON "project"."project_asset" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_asset_project_type_idx" ON "project"."project_asset" ("project_id","type");
