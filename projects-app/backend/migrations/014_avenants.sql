-- Migration 014: Avenants (Contract Amendments) System
-- نظام تدبير ملاحق العقود
-- 
-- An avenant modifies the original contract:
--   - Can add new bordereau lines (prix nouveaux)
--   - Can modify quantities of existing lines (augmentation/diminution)
--   - Can modify unit prices
--   - Affects total contract amount (montant marché)
--   - Has a formal approval workflow
--
-- Moroccan BTP context:
--   - CCAG-T (Cahier des Clauses Administratives Générales - Travaux)
--   - Article 51: Augmentation/diminution dans la masse des travaux
--   - Article 52: Changement dans l'importance des natures d'ouvrages
--   - Article 54: Augmentation de la masse des travaux au-delà du maximum

-- ═══════════════════════════════════════════════════════════════════════
-- AVENANTS TABLE: Main avenant record
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS avenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Identification
    numero INTEGER NOT NULL,                              -- Numéro de l'avenant (1, 2, 3...)
    objet TEXT NOT NULL,                                  -- Objet de l'avenant
    reference VARCHAR(200),                               -- Référence officielle
    
    -- Dates
    date_avenant DATE,                                    -- Date de l'avenant
    date_notification DATE,                               -- Date de notification
    date_approbation DATE,                                -- Date d'approbation
    
    -- Financial impact
    montant_initial DECIMAL(15,2) DEFAULT 0,              -- Montant marché avant avenant
    montant_avenant DECIMAL(15,2) DEFAULT 0,              -- Montant de l'avenant (+/-)
    montant_nouveau DECIMAL(15,2) DEFAULT 0,              -- Nouveau montant marché après avenant
    pourcentage_variation DECIMAL(8,4) DEFAULT 0,         -- % variation par rapport au montant initial
    
    -- Délais impact
    delais_supplementaire INTEGER DEFAULT 0,              -- Délais supplémentaires en jours
    nouveau_delais INTEGER,                               -- Nouveau délai total
    
    -- Type & Classification
    type_avenant VARCHAR(50) DEFAULT 'modification',      -- modification | prix_nouveaux | mixte | diminution
    motif TEXT,                                           -- Motif / justification
    
    -- Status
    statut VARCHAR(50) DEFAULT 'brouillon',               -- brouillon → en_attente → approuve → rejete → annule
    
    -- Bordereau modifications stored as JSONB
    -- Each item: { bordereauLigneId, action, ancienneQuantite, nouvelleQuantite, 
    --              ancienPrix, nouveauPrix, designation, unite, montantDifference }
    modifications JSONB DEFAULT '[]'::jsonb,
    
    -- Prix nouveaux (new lines added by this avenant)
    -- Each item: { id, numero, designation, unite, quantite, prixUnitaire, montant }
    prix_nouveaux JSONB DEFAULT '[]'::jsonb,
    
    -- Notes and observations
    observations TEXT,
    
    -- Sync support
    last_op_id UUID,
    version INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT unique_avenant_numero_per_project 
        UNIQUE (project_id, numero) 
);

-- Create partial unique index (excluding soft-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_avenant_active 
    ON avenants (project_id, numero) 
    WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES for performance
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_avenants_project_id ON avenants(project_id);
CREATE INDEX IF NOT EXISTS idx_avenants_user_id ON avenants(user_id);
CREATE INDEX IF NOT EXISTS idx_avenants_statut ON avenants(statut);
CREATE INDEX IF NOT EXISTS idx_avenants_deleted_at ON avenants(deleted_at);

-- ═══════════════════════════════════════════════════════════════════════
-- COMMENTS for documentation
-- ═══════════════════════════════════════════════════════════════════════
COMMENT ON TABLE avenants IS 'Contract amendments (ملاحق العقود) - tracks modifications to the original market contract';
COMMENT ON COLUMN avenants.type_avenant IS 'modification: qty/price changes | prix_nouveaux: new items | mixte: both | diminution: decrease';
COMMENT ON COLUMN avenants.statut IS 'brouillon→en_attente→approuve/rejete, annule for cancelled';
COMMENT ON COLUMN avenants.modifications IS 'JSONB array of changes to existing bordereau lines';
COMMENT ON COLUMN avenants.prix_nouveaux IS 'JSONB array of new bordereau lines added by this avenant';
