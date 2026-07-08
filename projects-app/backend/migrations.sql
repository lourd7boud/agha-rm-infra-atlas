-- Add missing columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS snss VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cbn VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rcn VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delais_entree_service DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS arrets JSONB DEFAULT NULL;

-- Add missing column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync TIMESTAMP;

-- Create photos table
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  file_name VARCHAR(255),
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  description TEXT,
  tags JSONB DEFAULT '[]',
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Create pvs table
CREATE TABLE IF NOT EXISTS pvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  type VARCHAR(100),
  numero VARCHAR(50),
  date DATE,
  objet TEXT,
  contenu TEXT,
  participants JSONB DEFAULT '[]',
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_pvs_project_id ON pvs(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_project_id ON attachments(project_id);

-- ============================================================
-- Migration 2: Add user_id and missing columns
-- ============================================================

-- Add user_id to all tables that need it
ALTER TABLE metres ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE pvs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- Add missing columns to metres
ALTER TABLE metres ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS reference VARCHAR(255);
ALTER TABLE metres ADD COLUMN IF NOT EXISTS mesures JSONB DEFAULT '[]';
ALTER TABLE metres ADD COLUMN IF NOT EXISTS total_quantite DECIMAL(15, 4) DEFAULT 0;

-- Add missing columns to bordereaux  
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS reference VARCHAR(255);
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS unite VARCHAR(50);
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS quantite DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS prix_unitaire DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS montant_total DECIMAL(15, 2) DEFAULT 0;

-- Add missing columns to periodes
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS description TEXT;

-- Create indexes for user_id columns
CREATE INDEX IF NOT EXISTS idx_metres_user_id ON metres(user_id);
CREATE INDEX IF NOT EXISTS idx_bordereaux_user_id ON bordereaux(user_id);
CREATE INDEX IF NOT EXISTS idx_periodes_user_id ON periodes(user_id);
CREATE INDEX IF NOT EXISTS idx_decompts_user_id ON decompts(user_id);

-- ============================================================
-- Migration 3: Add hierarchical structure for MetreV3
-- ============================================================

-- Add hierarchical structure columns to metres table
ALTER TABLE metres ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]';
ALTER TABLE metres ADD COLUMN IF NOT EXISTS sub_sections JSONB DEFAULT '[]';
ALTER TABLE metres ADD COLUMN IF NOT EXISTS lignes JSONB DEFAULT '[]';

-- Add missing columns used by MetrePageV3
ALTER TABLE metres ADD COLUMN IF NOT EXISTS bordereau_ligne_id VARCHAR(255);
ALTER TABLE metres ADD COLUMN IF NOT EXISTS designation_bordereau TEXT;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS unite VARCHAR(50);
ALTER TABLE metres ADD COLUMN IF NOT EXISTS total_partiel DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS total_cumule DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS quantite_bordereau DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS pourcentage_realisation DECIMAL(5, 2) DEFAULT 0;

-- Create index for faster lookup by bordereau_ligne_id
CREATE INDEX IF NOT EXISTS idx_metres_bordereau_ligne_id ON metres(bordereau_ligne_id);

-- Add comment for documentation
COMMENT ON COLUMN metres.sections IS 'JSON array of MetreSection objects (Douar/Lieu)';
COMMENT ON COLUMN metres.sub_sections IS 'JSON array of MetreSubSection objects (Element: semeille, radier, etc.)';
COMMENT ON COLUMN metres.lignes IS 'JSON array of MetreLigne objects (actual measurements)';
-- ============================================================
-- Migration 4: Add total_general_ttc to decompts
-- ============================================================
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS total_general_ttc DECIMAL(15, 2);
COMMENT ON COLUMN decompts.total_general_ttc IS 'Total Général (T.T.C) - المبلغ التراكمي الكلي';