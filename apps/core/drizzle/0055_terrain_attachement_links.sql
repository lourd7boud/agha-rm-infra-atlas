ALTER TABLE project.chantier_attachement ADD COLUMN IF NOT EXISTS metre_id uuid REFERENCES project.metre(id);
--> statement-breakpoint
ALTER TABLE project.chantier_attachement ADD COLUMN IF NOT EXISTS integrated_at timestamptz;
--> statement-breakpoint
ALTER TABLE project.chantier_attachement ADD COLUMN IF NOT EXISTS integrated_by text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chantier_attachement_metre_idx ON project.chantier_attachement(metre_id);
