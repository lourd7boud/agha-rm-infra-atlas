-- Migration: Add total_general_ttc column to decompts table
-- Date: 2026-02-02
-- Issue: Decompt creation failed with 500 error because column was missing in production

-- Add total_general_ttc column if not exists
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS total_general_ttc NUMERIC(15,2) DEFAULT 0;

-- Update existing records to have total_general_ttc = total_ttc if null
UPDATE decompts SET total_general_ttc = COALESCE(total_ttc, 0) WHERE total_general_ttc IS NULL;

-- Add comment
COMMENT ON COLUMN decompts.total_general_ttc IS 'Total général TTC including all previous décomptes';
