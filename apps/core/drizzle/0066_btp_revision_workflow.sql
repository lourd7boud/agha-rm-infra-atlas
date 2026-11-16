ALTER TABLE project.periode ADD COLUMN IF NOT EXISTS revision_monthly_ht jsonb;
--> statement-breakpoint
ALTER TABLE project.revision_index
  ADD COLUMN IF NOT EXISTS published_on date,
  ADD COLUMN IF NOT EXISTS previous_publications jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE project.project_revision_config
  ADD COLUMN IF NOT EXISTS contract_deadline date,
  ADD COLUMN IF NOT EXISTS delay_attributable boolean;
