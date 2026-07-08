-- Migration 016: Penalties & Bonds System (Pénalités & Cautions)
-- نظام الغرامات والضمانات
--
-- Moroccan BTP Context (CCAG-T):
--   - Article 60: Pénalités de retard (1/1000 per day, max 10% of contract)
--   - Article 12: Caution provisoire (bid bond)
--   - Article 13: Caution définitive (performance bond, 3% of contract)
--   - Article 40: Retenue de garantie (7% of each payment, or 10%)
--   - Caution personnelle et solidaire can replace retenue de garantie
--   - Mainlevée after réception définitive (after guarantee period)

-- ═══════════════════════════════════════════════════════════════════════
-- PENALTIES TABLE: Delay penalties and other financial penalties
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS penalties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Type
    type VARCHAR(50) NOT NULL DEFAULT 'retard'
      CHECK (type IN ('retard', 'malfacon', 'non_conformite', 'securite', 'environnement', 'autre')),
    
    -- Calculation
    date_debut DATE,                                         -- Start of penalty period
    date_fin DATE,                                           -- End of penalty period
    nombre_jours INTEGER DEFAULT 0,                          -- Number of penalty days
    taux DECIMAL(8,5) NOT NULL DEFAULT 0.001,                -- Rate (1/1000 = 0.001 per CCAG-T art.60)
    base_calcul DECIMAL(15,2),                               -- Base amount (usually contract amount)
    montant_penalite DECIMAL(15,2) NOT NULL DEFAULT 0,       -- Calculated penalty amount
    plafond_pourcentage DECIMAL(5,2) DEFAULT 10.00,          -- Cap percentage (10% by default)
    montant_plafond DECIMAL(15,2),                           -- Calculated cap amount
    montant_applique DECIMAL(15,2) NOT NULL DEFAULT 0,       -- Actually applied (min of penalty, cap)
    
    -- Status
    statut VARCHAR(30) NOT NULL DEFAULT 'calculee'
      CHECK (statut IN ('calculee', 'notifiee', 'contestee', 'appliquee', 'annulee', 'remise')),
    
    -- Notifications
    reference_notification VARCHAR(200),
    date_notification DATE,
    
    -- Details
    motif TEXT,
    observations TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- BONDS TABLE: Cautions et garanties
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bonds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Type
    type VARCHAR(50) NOT NULL
      CHECK (type IN (
        'caution_provisoire',          -- Bid bond
        'caution_definitive',          -- Performance bond (3%)
        'retenue_garantie',            -- Retention money (7% or 10%)
        'caution_avance',              -- Advance payment bond
        'caution_bonne_execution',     -- Good execution bond
        'garantie_decennale'           -- Decennial guarantee (10 years)
      )),
    
    -- Financial
    montant DECIMAL(15,2) NOT NULL DEFAULT 0,
    pourcentage DECIMAL(5,2),                                -- Percentage of contract
    base_calcul DECIMAL(15,2),                               -- Base for calculation
    
    -- Issuer
    organisme VARCHAR(300),                                  -- Bank or insurance company
    reference_organisme VARCHAR(200),                        -- Bank reference number
    
    -- Dates
    date_emission DATE,
    date_expiration DATE,
    date_mainlevee DATE,                                     -- Release date
    
    -- Status
    statut VARCHAR(30) NOT NULL DEFAULT 'active'
      CHECK (statut IN ('en_attente', 'active', 'expiree', 'liberee', 'saisie', 'annulee')),
    
    -- Details
    observations TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- RETENTION TABLE: Retenue de garantie tracking per décompte
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS retentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    bond_id UUID REFERENCES bonds(id) ON DELETE SET NULL,
    
    -- Reference
    decompt_id UUID,                                         -- Link to décompte
    decompt_numero INTEGER,
    
    -- Calculation
    montant_decompt DECIMAL(15,2) DEFAULT 0,                 -- Décompte amount
    taux_retenue DECIMAL(5,2) NOT NULL DEFAULT 7.00,         -- Retention rate (7% or 10%)
    montant_retenue DECIMAL(15,2) NOT NULL DEFAULT 0,        -- Calculated retention
    montant_cumule DECIMAL(15,2) DEFAULT 0,                  -- Cumulative retention
    
    -- Status
    liberee BOOLEAN NOT NULL DEFAULT false,
    date_liberation DATE,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_penalties_project ON penalties(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_penalties_type ON penalties(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_penalties_statut ON penalties(statut) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bonds_project ON bonds(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bonds_type ON bonds(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bonds_statut ON bonds(statut) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_retentions_project ON retentions(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_retentions_decompt ON retentions(decompt_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE penalties IS 'Pénalités de retard et autres pénalités contractuelles';
COMMENT ON TABLE bonds IS 'Cautions, garanties bancaires et assurances';
COMMENT ON TABLE retentions IS 'Retenues de garantie par décompte';
