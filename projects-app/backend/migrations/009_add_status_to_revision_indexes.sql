-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 Add status column to revision_indexes
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📌 Adds missing 'status' and audit columns to revision_indexes table
-- 📌 Date: January 27, 2026
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Add status column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'revision_indexes' AND column_name = 'status'
    ) THEN
        ALTER TABLE revision_indexes 
        ADD COLUMN status VARCHAR(50) DEFAULT 'provisoire';
        
        RAISE NOTICE 'Added status column to revision_indexes';
    END IF;
END $$;

-- Add created_by column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'revision_indexes' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE revision_indexes 
        ADD COLUMN created_by UUID REFERENCES users(id);
        
        RAISE NOTICE 'Added created_by column to revision_indexes';
    END IF;
END $$;

-- Add updated_by column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'revision_indexes' AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE revision_indexes 
        ADD COLUMN updated_by UUID REFERENCES users(id);
        
        RAISE NOTICE 'Added updated_by column to revision_indexes';
    END IF;
END $$;

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_revision_indexes_status ON revision_indexes(status);

-- Update existing rows to have default status
UPDATE revision_indexes SET status = 'provisoire' WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'revision_indexes';
