-- ============================================================
-- Migration 012: Décompte Data Integrity
-- ============================================================
-- Fixes: Orphan décomptes, duplicate décomptes per période
-- Root cause: 3 separate creation paths without DB-level uniqueness
-- ============================================================

-- ============================================================
-- Step 1: Clean up existing duplicates BEFORE adding constraints
-- Keep only the most recently updated décompte per (project_id, periode_id)
-- ============================================================

-- Soft-delete duplicate décomptes (keep the one with the latest updated_at)
WITH ranked_decompts AS (
  SELECT id,
         project_id,
         periode_id,
         numero,
         updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY project_id, periode_id
           ORDER BY 
             CASE WHEN lignes IS NOT NULL AND lignes::text != '[]' AND lignes::text != 'null' THEN 0 ELSE 1 END,
             updated_at DESC
         ) AS rn
  FROM decompts 
  WHERE deleted_at IS NULL
    AND periode_id IS NOT NULL
),
duplicates AS (
  SELECT id FROM ranked_decompts WHERE rn > 1
)
UPDATE decompts 
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE id IN (SELECT id FROM duplicates);

-- Also soft-delete orphan décomptes (periode doesn't exist or is deleted)
UPDATE decompts 
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND periode_id IS NOT NULL
  AND periode_id NOT IN (
    SELECT id FROM periodes WHERE deleted_at IS NULL
  );

-- Fix mismatched numeros: décompte.numero should match période.numero
UPDATE decompts d
SET numero = p.numero,
    updated_at = NOW()
FROM periodes p
WHERE d.periode_id = p.id
  AND d.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND d.numero != p.numero;

-- ============================================================
-- Step 2: Add unique partial indexes (WHERE deleted_at IS NULL)
-- ============================================================

-- Each active période can have at most ONE active décompte
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_decompt_per_periode 
  ON decompts (project_id, periode_id) 
  WHERE deleted_at IS NULL AND periode_id IS NOT NULL;

-- Each project can have at most ONE active décompte with a given numero
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_decompt_numero_per_project 
  ON decompts (project_id, numero) 
  WHERE deleted_at IS NULL;

-- ============================================================
-- Step 3: Add foreign key constraint (if not exists)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_decompts_periode'
  ) THEN
    ALTER TABLE decompts 
      ADD CONSTRAINT fk_decompts_periode 
      FOREIGN KEY (periode_id) 
      REFERENCES periodes(id) 
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK constraint already exists or could not be added: %', SQLERRM;
END $$;

-- ============================================================
-- Step 4: Same for períodes — one per (project_id, numero)
-- ============================================================

-- Clean up duplicate périodes first
WITH ranked_periodes AS (
  SELECT id,
         project_id,
         numero,
         updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY project_id, numero
           ORDER BY updated_at DESC
         ) AS rn
  FROM periodes 
  WHERE deleted_at IS NULL
),
duplicates AS (
  SELECT id FROM ranked_periodes WHERE rn > 1
)
UPDATE periodes 
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE id IN (SELECT id FROM duplicates);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_periode_numero_per_project 
  ON periodes (project_id, numero) 
  WHERE deleted_at IS NULL;

-- ============================================================
-- Step 5: Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_decompts_project_periode 
  ON decompts (project_id, periode_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_periodes_project_numero 
  ON periodes (project_id, numero) 
  WHERE deleted_at IS NULL;

-- Report what was cleaned
DO $$
DECLARE
  v_cleaned_decompts INTEGER;
  v_cleaned_periodes INTEGER;
  v_orphan_decompts INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cleaned_decompts 
  FROM decompts 
  WHERE deleted_at IS NOT NULL 
    AND deleted_at >= NOW() - INTERVAL '5 seconds';
    
  SELECT COUNT(*) INTO v_cleaned_periodes 
  FROM periodes 
  WHERE deleted_at IS NOT NULL 
    AND deleted_at >= NOW() - INTERVAL '5 seconds';

  RAISE NOTICE '🔧 Migration 012 completed:';
  RAISE NOTICE '  - Cleaned % duplicate/orphan décomptes', v_cleaned_decompts;
  RAISE NOTICE '  - Cleaned % duplicate périodes', v_cleaned_periodes;
  RAISE NOTICE '  - Added unique constraints on decompts and periodes';
END $$;
