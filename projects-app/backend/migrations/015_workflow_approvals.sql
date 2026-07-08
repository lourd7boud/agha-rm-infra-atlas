-- Migration 015: Workflow & Approval System (Circuit de Validation/Visa)
-- نظام سير عمل الموافقات والتأشيرات
--
-- BTP Context (Moroccan public works):
--   - Décomptes require OSC (Ordre de Service Commencer) visa chain
--   - Approval flow: Chef de chantier → Ingénieur → Chef de service → Directeur
--   - Avenants need multi-level approval before becoming effective
--   - PVs (Procès Verbaux) need signatures from multiple parties
--   - Rejection with comments and re-submission capability
--
-- This creates a generic, reusable approval system that can be attached to any document.

-- ═══════════════════════════════════════════════════════════════════════
-- APPROVAL WORKFLOWS: Template definitions
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Workflow definition
    name VARCHAR(200) NOT NULL,                              -- e.g. "Validation Décompte"
    description TEXT,
    document_type VARCHAR(50) NOT NULL,                      -- 'decompt', 'avenant', 'pv', 'ods', 'attachement'
    
    -- Steps definition (ordered JSON array)
    -- Each step: { order, role, label, required, autoApproveIfPrevious }
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Settings
    is_active BOOLEAN NOT NULL DEFAULT true,
    require_all_steps BOOLEAN NOT NULL DEFAULT true,         -- All steps must approve
    allow_parallel BOOLEAN NOT NULL DEFAULT false,           -- Steps can be done in parallel
    auto_advance BOOLEAN NOT NULL DEFAULT true,              -- Auto-move to next step on approval
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- APPROVAL REQUESTS: Actual approval instances for documents
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),              -- Who initiated the request
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES approval_workflows(id) ON DELETE SET NULL,
    
    -- Document reference
    document_type VARCHAR(50) NOT NULL,                      -- 'decompt', 'avenant', 'pv', 'attachement'
    document_id UUID NOT NULL,                               -- Reference to the actual document
    document_reference VARCHAR(300),                         -- Human-readable ref (e.g. "Décompte N°3")
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'en_attente'         -- 'en_attente', 'en_cours', 'approuve', 'rejete', 'annule'
      CHECK (status IN ('en_attente', 'en_cours', 'approuve', 'rejete', 'annule')),
    current_step INTEGER NOT NULL DEFAULT 1,
    total_steps INTEGER NOT NULL DEFAULT 1,
    
    -- Priority & urgency
    priority VARCHAR(20) NOT NULL DEFAULT 'normal'           -- 'basse', 'normal', 'haute', 'urgente'
      CHECK (priority IN ('basse', 'normal', 'haute', 'urgente')),
    due_date DATE,                                           -- Deadline for approval
    
    -- Initiator's note
    note TEXT,
    
    -- Financial context  
    montant DECIMAL(15,2),                                   -- Amount being approved (for quick reference)
    
    -- Metadata
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- APPROVAL STEPS: Individual approval decisions within a request
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    
    -- Step info
    step_order INTEGER NOT NULL,                             -- 1, 2, 3...
    step_label VARCHAR(200) NOT NULL,                        -- "Visa Ingénieur", "Approbation Directeur"
    role VARCHAR(100),                                       -- Expected role: 'ingenieur', 'chef_service', 'directeur'
    
    -- Decision
    status VARCHAR(30) NOT NULL DEFAULT 'en_attente'
      CHECK (status IN ('en_attente', 'en_cours', 'approuve', 'rejete', 'renvoye')),
    decided_by UUID REFERENCES users(id),
    decided_by_name VARCHAR(200),                            -- Snapshot for audit trail
    decision_date TIMESTAMPTZ,
    
    -- Comments
    comment TEXT,
    
    -- Conditions (optional)
    conditions TEXT,                                          -- Any conditions attached to approval
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- APPROVAL HISTORY: Full audit trail
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    step_id UUID REFERENCES approval_steps(id) ON DELETE SET NULL,
    
    -- Action
    action VARCHAR(50) NOT NULL,                             -- 'submitted', 'approved', 'rejected', 'returned', 'cancelled', 'resubmitted', 'comment'
    actor_id UUID REFERENCES users(id),
    actor_name VARCHAR(200),
    
    -- Details
    comment TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,                      -- Extra data (e.g. old status, new status)
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_approval_workflows_user ON approval_workflows(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_workflows_project ON approval_workflows(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_workflows_doctype ON approval_workflows(document_type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_user ON approval_requests(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_project ON approval_requests(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_document ON approval_requests(document_type, document_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_priority ON approval_requests(priority, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_approval_steps_request ON approval_steps(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_status ON approval_steps(status);
CREATE INDEX IF NOT EXISTS idx_approval_steps_decided_by ON approval_steps(decided_by);

CREATE INDEX IF NOT EXISTS idx_approval_history_request ON approval_history(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_history_actor ON approval_history(actor_id);

-- ═══════════════════════════════════════════════════════════════════════
-- DEFAULT WORKFLOW TEMPLATES (Moroccan BTP standard)
-- ═══════════════════════════════════════════════════════════════════════
-- Note: These are created per-user when they first set up workflows.
-- The application will offer these as templates.

COMMENT ON TABLE approval_workflows IS 'Workflow templates defining approval chains for different document types';
COMMENT ON TABLE approval_requests IS 'Active approval requests linked to specific documents';
COMMENT ON TABLE approval_steps IS 'Individual steps/decisions within an approval request';
COMMENT ON TABLE approval_history IS 'Full audit trail of all approval actions';
