-- ============================================================
-- Migration 021: User Management System
-- Adds: project_members, user_sessions, audit_logs_server
-- Enhances: users table with job_title, phone, avatar_url
-- ============================================================

-- 1. Enhance users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);

-- 2. Project Members — links users to specific projects with roles
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  -- Roles: chef_projet, ingenieur, conducteur, metreur, viewer
  permissions JSONB DEFAULT '{}',
  -- e.g. {"canEditMetre": true, "canEditDecompt": false, "canApprove": true}
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_role ON project_members(role);

-- 3. User Sessions — tracks active sessions for presence
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  socket_id VARCHAR(100),
  device_info JSONB DEFAULT '{}',
  -- e.g. {"browser": "Chrome", "os": "Windows", "ip": "..."}
  current_page VARCHAR(255),
  current_project_id UUID REFERENCES projects(id),
  current_activity TEXT,
  -- e.g. "Editing Décompte N°3", "Viewing Bordereau"
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_project ON user_sessions(current_project_id) WHERE current_project_id IS NOT NULL;

-- 4. Server-side Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs_server (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  -- e.g. user.create, user.update, user.delete, user.login, user.logout
  -- project.create, project.update, decompt.save, metre.update
  entity_type VARCHAR(100),
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_server_user ON audit_logs_server(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_server_action ON audit_logs_server(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_server_entity ON audit_logs_server(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_server_created ON audit_logs_server(created_at DESC);

-- 5. Auto-cleanup old sessions (mark inactive after 10 min of no heartbeat)
-- This will be called periodically from the backend
CREATE OR REPLACE FUNCTION cleanup_stale_sessions() RETURNS void AS $$
BEGIN
  UPDATE user_sessions 
  SET is_active = false, disconnected_at = NOW()
  WHERE is_active = true 
    AND last_heartbeat < NOW() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql;
