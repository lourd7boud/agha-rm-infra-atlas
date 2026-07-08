-- ═══════════════════════════════════════════════════════════════════════════════════
-- Migration 008: Index Audit Log for Phase 4B
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 
-- Purpose: Track all changes to revision indexes (who/when/what)
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Add status column to revision_indexes if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'revision_indexes' AND column_name = 'status'
  ) THEN
    ALTER TABLE revision_indexes ADD COLUMN status VARCHAR(20) DEFAULT 'provisoire';
  END IF;
END $$;

-- Add created_by and updated_by columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'revision_indexes' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE revision_indexes ADD COLUMN created_by UUID REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'revision_indexes' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE revision_indexes ADD COLUMN updated_by UUID REFERENCES users(id);
  END IF;
END $$;

-- Create audit log table
CREATE TABLE IF NOT EXISTS index_audit_log (
  id SERIAL PRIMARY KEY,
  
  -- What was changed
  month_date DATE NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete', 'import', 'status_change'
  
  -- Who changed it
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(255),
  
  -- Change details
  changes JSONB, -- {"field": "At", "old": 311.5, "new": 312.0} or full snapshot
  
  -- Context
  source VARCHAR(255), -- 'ui', 'excel_import', 'api'
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_audit_log_month ON index_audit_log(month_date);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON index_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON index_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON index_audit_log(created_at DESC);

-- Update existing data to have status
UPDATE revision_indexes 
SET status = CASE 
  WHEN notes LIKE '%provisoire%' THEN 'provisoire'
  ELSE 'definitif'
END
WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 008 completed successfully';
  RAISE NOTICE '  - Added status column to revision_indexes';
  RAISE NOTICE '  - Added created_by/updated_by columns';
  RAISE NOTICE '  - Created index_audit_log table';
END $$;
