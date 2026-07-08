-- ============================================================
-- Migration 013: Photo Albums - Add Missing Columns
-- ============================================================
-- Adds columns required by album controller:
--   sort_order, color, icon, periode_id
-- These were referenced in code but missing from the table
-- ============================================================

-- Sort order for album display ordering
ALTER TABLE photo_albums ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Color for album card UI
ALTER TABLE photo_albums ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT '#3B82F6';

-- Icon identifier for album card UI
ALTER TABLE photo_albums ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'folder';

-- Optional link to a période
ALTER TABLE photo_albums ADD COLUMN IF NOT EXISTS periode_id UUID REFERENCES periodes(id) ON DELETE SET NULL;

-- ============================================================
-- Trust Proxy Fix (code change, not SQL)
-- ============================================================
-- Also in this release: added app.set('trust proxy', 1) in
-- backend/src/index.ts to fix express-rate-limit crash
-- (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) when behind nginx.
-- ============================================================
