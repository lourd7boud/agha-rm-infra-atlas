-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 011: Realtime Sync Tables & Columns
-- ═══════════════════════════════════════════════════════════════════════════
-- Previously this DDL ran on EVERY server boot from pgNotify.ts.
-- Phase 2 audit moved it here so it runs once via migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ops table for sync operations
CREATE TABLE IF NOT EXISTS ops (
  server_seq BIGSERIAL PRIMARY KEY,
  op_id UUID NOT NULL UNIQUE,
  client_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL,
  ts TIMESTAMP NOT NULL DEFAULT NOW(),
  entity VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  op_type VARCHAR(50) NOT NULL,
  payload JSONB,
  applied BOOLEAN DEFAULT TRUE,
  applied_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for ops table
CREATE INDEX IF NOT EXISTS idx_ops_user_id ON ops(user_id);
CREATE INDEX IF NOT EXISTS idx_ops_entity ON ops(entity);
CREATE INDEX IF NOT EXISTS idx_ops_entity_id ON ops(entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_server_seq ON ops(server_seq);
CREATE INDEX IF NOT EXISTS idx_ops_client_id ON ops(client_id);
CREATE INDEX IF NOT EXISTS idx_ops_ts ON ops(ts);
CREATE INDEX IF NOT EXISTS idx_ops_user_seq ON ops(user_id, server_seq);

-- Sync clients table
CREATE TABLE IF NOT EXISTS sync_clients (
  client_id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL,
  last_push_at TIMESTAMP,
  last_pull_at TIMESTAMP,
  last_pushed_seq BIGINT DEFAULT 0,
  last_pulled_seq BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_clients_user_id ON sync_clients(user_id);

-- Add sync tracking columns to all entity tables
DO $$ 
BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS reference VARCHAR(255);
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS designation TEXT;
  ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS montant_total DECIMAL(15,2) DEFAULT 0;
  
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS libelle VARCHAR(255);
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS statut VARCHAR(50) DEFAULT 'en_cours';
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS is_decompte_dernier BOOLEAN DEFAULT FALSE;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS observations TEXT;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS taux_tva DECIMAL(5,2) DEFAULT 20;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS taux_retenue DECIMAL(5,2) DEFAULT 10;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS depenses_exercices_anterieurs DECIMAL(15,2) DEFAULT 0;
  ALTER TABLE periodes ADD COLUMN IF NOT EXISTS decomptes_precedents DECIMAL(15,2) DEFAULT 0;
  
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS reference VARCHAR(255);
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS designation_bordereau TEXT;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS unite VARCHAR(50);
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS lignes JSONB DEFAULT '[]';
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS total_partiel DECIMAL(15,4) DEFAULT 0;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS total_cumule DECIMAL(15,4) DEFAULT 0;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS quantite_bordereau DECIMAL(15,4) DEFAULT 0;
  ALTER TABLE metres ADD COLUMN IF NOT EXISTS pourcentage_realisation DECIMAL(5,2) DEFAULT 0;
  
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS lignes JSONB DEFAULT '[]';
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS total_ttc DECIMAL(15,2) DEFAULT 0;
  ALTER TABLE decompts ADD COLUMN IF NOT EXISTS statut VARCHAR(50) DEFAULT 'draft';
  
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS local_path TEXT;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'pending';
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  
  ALTER TABLE pvs ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE pvs ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE pvs ADD COLUMN IF NOT EXISTS user_id UUID;
  
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS category VARCHAR(100);
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS linked_to JSONB;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS local_path TEXT;
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'pending';
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);
  ALTER TABLE attachments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_op_id UUID;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

  ALTER TABLE projects ADD COLUMN IF NOT EXISTS arrets JSONB DEFAULT '[]';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS ordre_service VARCHAR(50);
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Performance indexes (Phase 2 audit)
-- ═══════════════════════════════════════════════════════════════════════════

-- Soft-delete indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bordereaux_deleted_at ON bordereaux(deleted_at);
CREATE INDEX IF NOT EXISTS idx_decompts_deleted_at ON decompts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_pvs_deleted_at ON pvs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_periodes_deleted_at ON periodes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_metres_deleted_at ON metres(deleted_at);

-- Foreign key indexes for joins
CREATE INDEX IF NOT EXISTS idx_bordereaux_project_id ON bordereaux(project_id);
CREATE INDEX IF NOT EXISTS idx_decompts_project_id ON decompts(project_id);
CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_pvs_project_id ON pvs(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_project_id ON attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_periodes_project_id ON periodes(project_id);
CREATE INDEX IF NOT EXISTS idx_metres_project_id ON metres(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- User lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_projects_user_active ON projects(user_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bordereaux_project_active ON bordereaux(project_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_decompts_project_active ON decompts(project_id, deleted_at) WHERE deleted_at IS NULL;
