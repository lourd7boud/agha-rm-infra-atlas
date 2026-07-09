-- Native "Projets & Chantiers" execution schema ported from the BTP app:
-- extends project.project with marché-de-travaux detail fields and adds the
-- bordereau / période / métré / décompte / révision-des-prix tables. Additive
-- only — project.situation (read by finance) is untouched.
ALTER TABLE "project"."project" ADD COLUMN "objet" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "annee" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "societe" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "commune" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "type_marche" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "mode_passation" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "delai_execution_jours" integer;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "date_ouverture" date;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "reception_provisoire" date;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "reception_definitive" date;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "achevement_travaux" date;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "assistance_technique" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "maitre_oeuvre" text;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "progress_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project"."project" ADD COLUMN "legacy_user_id" uuid;--> statement-breakpoint
CREATE TABLE "project"."bordereau" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"lignes" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."periode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"libelle" text,
	"date_debut" date,
	"date_fin" date,
	"taux_tva" numeric(5, 2) DEFAULT '20' NOT NULL,
	"taux_retenue" numeric(5, 2) DEFAULT '10' NOT NULL,
	"decomptes_precedents" numeric(14, 2) DEFAULT '0' NOT NULL,
	"depenses_exercices_anterieurs" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_decompte_dernier" boolean DEFAULT false NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"observations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."metre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"periode_id" uuid,
	"bordereau_ligne_id" text,
	"designation" text,
	"unite" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"total_quantite" numeric(16, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."decompte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"periode_id" uuid,
	"numero" integer NOT NULL,
	"date_decompte" date,
	"lignes" jsonb DEFAULT '[]' NOT NULL,
	"total_ht_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"montant_tva_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_ttc_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_general_ttc_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"montant_cumule_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"montant_precedent_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"montant_actuel_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"retenue_garantie_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_a_payer_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_dernier" boolean DEFAULT false NOT NULL,
	"statut" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."revision_formula" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fixed_part" numeric(6, 4) DEFAULT '0.15' NOT NULL,
	"weights" jsonb DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."revision_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_date" date NOT NULL,
	"index_values" jsonb DEFAULT '{}' NOT NULL,
	"source" text,
	"status" text DEFAULT 'provisoire' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_index_month_date_unique" UNIQUE("month_date")
);
--> statement-breakpoint
CREATE TABLE "project"."project_revision_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"formula_id" uuid,
	"base_indexes" jsonb DEFAULT '{}' NOT NULL,
	"base_date" date,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_revision_config_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project"."decompte_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decompte_id" uuid NOT NULL,
	"montant_a_reviser" numeric(14, 2),
	"coefficient_applique" numeric(12, 6),
	"montant_revision" numeric(14, 2),
	"calculation_details" jsonb,
	"status" text DEFAULT 'calculated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decompte_revision_decompte_id_unique" UNIQUE("decompte_id")
);
--> statement-breakpoint
ALTER TABLE "project"."bordereau" ADD CONSTRAINT "bordereau_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."periode" ADD CONSTRAINT "periode_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."metre" ADD CONSTRAINT "metre_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."metre" ADD CONSTRAINT "metre_periode_id_periode_id_fk" FOREIGN KEY ("periode_id") REFERENCES "project"."periode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."decompte" ADD CONSTRAINT "decompte_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."decompte" ADD CONSTRAINT "decompte_periode_id_periode_id_fk" FOREIGN KEY ("periode_id") REFERENCES "project"."periode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."project_revision_config" ADD CONSTRAINT "project_revision_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."project_revision_config" ADD CONSTRAINT "project_revision_config_formula_id_revision_formula_id_fk" FOREIGN KEY ("formula_id") REFERENCES "project"."revision_formula"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project"."decompte_revision" ADD CONSTRAINT "decompte_revision_decompte_id_decompte_id_fk" FOREIGN KEY ("decompte_id") REFERENCES "project"."decompte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bordereau_project_id_idx" ON "project"."bordereau" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "periode_project_id_idx" ON "project"."periode" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "metre_project_id_idx" ON "project"."metre" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "decompte_project_id_idx" ON "project"."decompte" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "decompte_revision_decompte_id_idx" ON "project"."decompte_revision" USING btree ("decompte_id");
