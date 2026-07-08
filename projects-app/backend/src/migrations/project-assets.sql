-- ============================================================
-- Migration: project_assets (Unified Asset Management V1)
-- Date: 2025-12-24
-- Description: Single unified table for photos, PV, and documents
-- ============================================================

-- Create project_assets table (unified)
CREATE TABLE IF NOT EXISTS project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('photo', 'pv', 'document')),
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_assets_project_id ON project_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assets_type ON project_assets(type);
CREATE INDEX IF NOT EXISTS idx_project_assets_project_type ON project_assets(project_id, type);
CREATE INDEX IF NOT EXISTS idx_project_assets_created_at ON project_assets(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE project_assets IS 'Unified table for all project assets: photos, PV (procès-verbaux), and documents';
COMMENT ON COLUMN project_assets.type IS 'Asset type: photo, pv, or document';
COMMENT ON COLUMN project_assets.storage_path IS 'Relative path to the file in uploads folder';
COMMENT ON COLUMN project_assets.metadata IS 'JSON metadata specific to each type (e.g., PV type, date, observations)';
