-- Migration 017: Journal de Chantier Numérique (Digital Site Diary)
-- سجل الأشغال الرقمي
-- Date: 2026-02-19

-- ═══════════════════════════════════════════════════════════════
-- 1. JOURNAL ENTRIES — Daily site diary entries
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_diary_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    -- Date & Identification
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_number INTEGER NOT NULL DEFAULT 1,

    -- Weather conditions (météo)
    weather VARCHAR(30) DEFAULT 'ensoleille'
      CHECK (weather IN ('ensoleille', 'nuageux', 'pluvieux', 'venteux', 'orageux', 'brumeux', 'chaud', 'froid')),
    temperature_min DECIMAL(5,1),
    temperature_max DECIMAL(5,1),

    -- Workforce (effectifs)
    workforce_own INTEGER DEFAULT 0,          -- Ouvriers propres
    workforce_subcontractor INTEGER DEFAULT 0, -- Ouvriers sous-traitants
    workforce_supervisors INTEGER DEFAULT 0,   -- Encadrement

    -- Equipment (matériel)
    equipment JSONB DEFAULT '[]'::jsonb,
    -- [ { name: "Pelle hydraulique", quantity: 2, status: "en_service" }, ... ]

    -- Activities (activités du jour)
    activities JSONB DEFAULT '[]'::jsonb,
    -- [ { description: "Coulage béton dalle RDC", lot: "Gros oeuvre", progress: 75, status: "en_cours" }, ... ]

    -- Materials delivered (matériaux livrés)
    materials_delivered JSONB DEFAULT '[]'::jsonb,
    -- [ { designation: "Ciment CPJ-45", quantity: 50, unite: "tonnes", fournisseur: "LafargeHolcim" }, ... ]

    -- Incidents & observations
    incidents JSONB DEFAULT '[]'::jsonb,
    -- [ { type: "accident", severity: "mineur", description: "...", actions: "..." }, ... ]

    observations TEXT,
    instructions TEXT,

    -- Visitors (visiteurs)
    visitors JSONB DEFAULT '[]'::jsonb,
    -- [ { name: "M. Alami", role: "Maître d'ouvrage", arrival: "09:00", departure: "11:30" }, ... ]

    -- Photos references (optional links to uploads)
    photos JSONB DEFAULT '[]'::jsonb,
    -- [ { url: "/uploads/...", caption: "Vue d'ensemble du chantier" }, ... ]

    -- Status
    statut VARCHAR(30) NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'valide', 'signe', 'archive')),

    -- Signatures
    signed_by_conductor TEXT,      -- Chef de chantier
    signed_by_supervisor TEXT,     -- Directeur des travaux
    signed_at TIMESTAMPTZ,

    -- Standard metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_diary_project ON site_diary_entries(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_diary_date ON site_diary_entries(project_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_diary_statut ON site_diary_entries(statut) WHERE deleted_at IS NULL;

-- Unique constraint: one entry per project per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_diary_unique_date ON site_diary_entries(project_id, entry_date) WHERE deleted_at IS NULL;

-- Auto-increment entry_number per project
CREATE OR REPLACE FUNCTION set_diary_entry_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entry_number IS NULL OR NEW.entry_number = 1 THEN
    SELECT COALESCE(MAX(entry_number), 0) + 1
    INTO NEW.entry_number
    FROM site_diary_entries
    WHERE project_id = NEW.project_id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_diary_entry_number ON site_diary_entries;
CREATE TRIGGER trg_diary_entry_number
  BEFORE INSERT ON site_diary_entries
  FOR EACH ROW EXECUTE FUNCTION set_diary_entry_number();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_diary_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_diary_updated_at ON site_diary_entries;
CREATE TRIGGER trg_diary_updated_at
  BEFORE UPDATE ON site_diary_entries
  FOR EACH ROW EXECUTE FUNCTION update_diary_timestamp();

COMMENT ON TABLE site_diary_entries IS 'Journal de chantier numérique — سجل الأشغال اليومي';
