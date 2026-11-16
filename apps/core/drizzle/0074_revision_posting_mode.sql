ALTER TABLE project.project_revision_config
  ADD COLUMN posting_mode text NOT NULL DEFAULT 'each_decompte'
  CONSTRAINT project_revision_posting_mode_check CHECK (posting_mode IN ('each_decompte', 'final_only'));
