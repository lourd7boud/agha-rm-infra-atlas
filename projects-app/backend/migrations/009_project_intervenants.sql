-- ============================================================
-- Migration 009: Add project intervenants (Assistance Technique & Maître d'Oeuvre)
-- ============================================================

-- Add assistance_technique column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS assistance_technique VARCHAR(255);
COMMENT ON COLUMN projects.assistance_technique IS 'L''ASSISTANCE TECHNIQUE - Bureau d''études ou assistance technique du projet';

-- Add maitre_oeuvre column to projects table  
ALTER TABLE projects ADD COLUMN IF NOT EXISTS maitre_oeuvre VARCHAR(255);
COMMENT ON COLUMN projects.maitre_oeuvre IS 'Le Maître d''Oeuvre - Responsable de la maîtrise d''oeuvre du projet';

-- Create indexes for filtering by intervenants
CREATE INDEX IF NOT EXISTS idx_projects_assistance_technique ON projects(assistance_technique);
CREATE INDEX IF NOT EXISTS idx_projects_maitre_oeuvre ON projects(maitre_oeuvre);
