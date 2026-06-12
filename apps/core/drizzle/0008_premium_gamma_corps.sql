CREATE TABLE "project"."avenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"objet" text NOT NULL,
	"montant_delta_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delai_delta_mois" numeric(4, 1) DEFAULT '0' NOT NULL,
	"approved_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project"."avenant" ADD CONSTRAINT "avenant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"."project"("id") ON DELETE no action ON UPDATE no action;