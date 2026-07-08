-- Migration 020: Gantt Planning / Planification des travaux
-- Feature 10: Interactive Gantt chart for BTP project scheduling

-- Planning tasks (lots, phases, sous-phases)
CREATE TABLE IF NOT EXISTS planning_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES planning_tasks(id) ON DELETE CASCADE,
    
    -- Task info
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'task' CHECK (type IN ('phase', 'lot', 'task', 'milestone')),
    
    -- Scheduling
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    duree_jours INTEGER GENERATED ALWAYS AS (date_fin - date_debut + 1) STORED,
    
    -- Progress
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    
    -- Visual
    color VARCHAR(7),
    sort_order INTEGER NOT NULL DEFAULT 0,
    
    -- Status
    statut VARCHAR(20) NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie', 'en_cours', 'termine', 'en_retard', 'suspendu')),
    
    -- Responsable
    responsable VARCHAR(255),
    
    -- Resources / cost
    cout_prevu DECIMAL(15,2) DEFAULT 0,
    cout_reel DECIMAL(15,2) DEFAULT 0,
    
    -- Metadata
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dependencies between tasks (FS, FF, SS, SF)
CREATE TABLE IF NOT EXISTS planning_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    predecessor_id UUID NOT NULL REFERENCES planning_tasks(id) ON DELETE CASCADE,
    successor_id UUID NOT NULL REFERENCES planning_tasks(id) ON DELETE CASCADE,
    type VARCHAR(2) NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'FF', 'SS', 'SF')),
    lag_days INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(predecessor_id, successor_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_planning_tasks_project ON planning_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_parent ON planning_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_dates ON planning_tasks(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_type ON planning_tasks(type);
CREATE INDEX IF NOT EXISTS idx_planning_deps_project ON planning_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_planning_deps_predecessor ON planning_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_planning_deps_successor ON planning_dependencies(successor_id);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_planning_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_planning_tasks ON planning_tasks;
CREATE TRIGGER trigger_update_planning_tasks
    BEFORE UPDATE ON planning_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_planning_tasks_timestamp();
