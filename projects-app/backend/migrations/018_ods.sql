-- Migration 018: Ordres de Service (ODS) — Service Orders Management
-- أوامر الخدمة
-- Date: 2026-02-19

-- ═══════════════════════════════════════════════════════════════
-- 1. ORDRES DE SERVICE — Service Orders table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ordres_service (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    -- Identification
    numero INTEGER NOT NULL DEFAULT 1,
    reference VARCHAR(100),

    -- Type d'ODS (CCAG-T marocain)
    type VARCHAR(50) NOT NULL DEFAULT 'commencement'
      CHECK (type IN (
        'commencement',         -- Commencement des travaux
        'arret',                -- Arrêt des travaux
        'reprise',              -- Reprise des travaux
        'modification',         -- Modification des travaux
        'travaux_supplementaires', -- Travaux supplémentaires
        'prolongation',         -- Prolongation de délai
        'reception_provisoire', -- Réception provisoire
        'reception_definitive', -- Réception définitive
        'mise_en_demeure',      -- Mise en demeure
        'autre'                 -- Autre
      )),

    -- Content
    objet VARCHAR(500) NOT NULL,
    description TEXT,
    motif TEXT,

    -- Dates
    date_emission DATE NOT NULL DEFAULT CURRENT_DATE,
    date_effet DATE,
    date_fin DATE,
    delai_jours INTEGER,

    -- Financial impact
    impact_financier DECIMAL(15,2) DEFAULT 0,
    impact_delai INTEGER DEFAULT 0,

    -- Parties
    emetteur VARCHAR(200),          -- Qui émet l'ODS
    destinataire VARCHAR(200),      -- Qui reçoit l'ODS
    emetteur_fonction VARCHAR(200), -- Fonction de l'émetteur

    -- References
    avenant_id UUID REFERENCES avenants(id),
    ods_parent_id UUID REFERENCES ordres_service(id),

    -- Documents attachés (references)
    pieces_jointes JSONB DEFAULT '[]'::jsonb,
    -- [ { name: "Lettre_ODS_01.pdf", url: "/uploads/..." }, ... ]

    -- Status workflow
    statut VARCHAR(30) NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'emis', 'notifie', 'accuse', 'execute', 'cloture', 'annule')),

    -- Signatures / Accusé de réception
    date_notification DATE,
    date_accuse_reception DATE,
    accuse_par VARCHAR(200),
    observations_destinataire TEXT,

    -- Standard metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ods_project ON ordres_service(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ods_type ON ordres_service(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ods_statut ON ordres_service(statut) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ods_date ON ordres_service(project_id, date_emission DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ods_parent ON ordres_service(ods_parent_id) WHERE deleted_at IS NULL;

-- Auto-increment numero per project
CREATE OR REPLACE FUNCTION set_ods_numero()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 1 THEN
    SELECT COALESCE(MAX(numero), 0) + 1
    INTO NEW.numero
    FROM ordres_service
    WHERE project_id = NEW.project_id AND deleted_at IS NULL;
  END IF;
  -- Auto-generate reference
  IF NEW.reference IS NULL THEN
    NEW.reference := 'ODS-' || LPAD(NEW.numero::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ods_numero ON ordres_service;
CREATE TRIGGER trg_ods_numero
  BEFORE INSERT ON ordres_service
  FOR EACH ROW EXECUTE FUNCTION set_ods_numero();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_ods_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ods_updated_at ON ordres_service;
CREATE TRIGGER trg_ods_updated_at
  BEFORE UPDATE ON ordres_service
  FOR EACH ROW EXECUTE FUNCTION update_ods_timestamp();

COMMENT ON TABLE ordres_service IS 'Ordres de Service — أوامر الخدمة — CCAG-T articles 9 et 10';
