CREATE TABLE project.revision_index_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_import_id uuid,
  source_url text NOT NULL,
  filename text NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  source_last_modified text,
  document_date date,
  reference text,
  status text NOT NULL DEFAULT 'extracting',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  months jsonb NOT NULL DEFAULT '[]'::jsonb,
  ocr_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure text,
  lease_token uuid,
  lease_expires_at timestamptz,
  applied_digest text,
  applied_request jsonb,
  applied_result jsonb,
  applied_at timestamptz,
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX revision_index_import_sha_idx ON project.revision_index_import(sha256);
--> statement-breakpoint
CREATE INDEX revision_index_import_observed_idx ON project.revision_index_import(observed_at);
