-- =====================================================
-- Migration: Enhanced Ops-Log Sync System
-- Version: 1.0.0
-- Date: 2024-12-11
-- =====================================================

-- 1. Create the new ops table with server_seq for reliable ordering
CREATE TABLE IF NOT EXISTS ops (
  server_seq BIGSERIAL PRIMARY KEY,
  op_id UUID UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op_type TEXT NOT NULL CHECK (op_type IN ('CREATE', 'UPDATE', 'DELETE')),
  payload JSONB NOT NULL DEFAULT '{}',
  base_seq BIGINT,  -- The server_seq the client knew about when creating this op
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ops_client_id ON ops(client_id);
CREATE INDEX IF NOT EXISTS idx_ops_user_id ON ops(user_id);
CREATE INDEX IF NOT EXISTS idx_ops_entity ON ops(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_ts ON ops(ts);
CREATE INDEX IF NOT EXISTS idx_ops_applied ON ops(applied);
CREATE INDEX IF NOT EXISTS idx_ops_server_seq_user ON ops(server_seq, user_id);

-- 3. Create entity_history table for audit trail and rollback
CREATE TABLE IF NOT EXISTS entity_history (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op_id UUID REFERENCES ops(op_id),
  server_seq BIGINT REFERENCES ops(server_seq),
  previous_state JSONB,
  new_state JSONB,
  changed_fields TEXT[],
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_history_entity ON entity_history(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_history_changed_at ON entity_history(changed_at);

-- 4. Create sync_clients table to track client sync states
CREATE TABLE IF NOT EXISTS sync_clients (
  id SERIAL PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),
  last_pushed_seq BIGINT DEFAULT 0,
  last_pulled_seq BIGINT DEFAULT 0,
  last_push_at TIMESTAMPTZ,
  last_pull_at TIMESTAMPTZ,
  device_info JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_clients_user_id ON sync_clients(user_id);

-- 5. Create conflicts table for unresolved conflicts
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id BIGSERIAL PRIMARY KEY,
  op_id UUID REFERENCES ops(op_id),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  local_data JSONB NOT NULL,
  remote_data JSONB NOT NULL,
  conflict_type TEXT NOT NULL, -- 'concurrent_update', 'delete_update', 'schema_mismatch'
  resolution TEXT, -- 'local_wins', 'remote_wins', 'merged', 'pending'
  resolved_data JSONB,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user ON sync_conflicts(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolution ON sync_conflicts(resolution);

-- 6. Add version columns to main entity tables for optimistic locking
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE periodes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE metres ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE metres ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE decompts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE photos ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE pvs ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE pvs ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE pvs ADD COLUMN IF NOT EXISTS last_op_id UUID;

-- 7. Create function to apply an operation (idempotent)
CREATE OR REPLACE FUNCTION apply_op(
  p_op_id UUID,
  p_client_id TEXT,
  p_user_id UUID,
  p_ts TIMESTAMPTZ,
  p_entity TEXT,
  p_entity_id TEXT,
  p_op_type TEXT,
  p_payload JSONB,
  p_base_seq BIGINT DEFAULT NULL
) RETURNS TABLE (
  result_server_seq BIGINT,
  result_status TEXT,
  result_message TEXT
) AS $$
DECLARE
  v_server_seq BIGINT;
  v_existing_seq BIGINT;
  v_table_name TEXT;
  v_clean_entity_id TEXT;
  v_previous_state JSONB;
BEGIN
  -- Check if op already exists (idempotency)
  SELECT server_seq INTO v_existing_seq FROM ops WHERE op_id = p_op_id;
  
  IF v_existing_seq IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_seq, 'duplicate'::TEXT, 'Operation already processed'::TEXT;
    RETURN;
  END IF;
  
  -- Map entity to table name
  v_table_name := CASE p_entity
    WHEN 'project' THEN 'projects'
    WHEN 'bordereau' THEN 'bordereaux'
    WHEN 'periode' THEN 'periodes'
    WHEN 'metre' THEN 'metres'
    WHEN 'decompt' THEN 'decompts'
    WHEN 'attachment' THEN 'attachments'
    WHEN 'photo' THEN 'photos'
    WHEN 'pv' THEN 'pvs'
    ELSE NULL
  END;
  
  IF v_table_name IS NULL THEN
    RETURN QUERY SELECT 0::BIGINT, 'error'::TEXT, ('Unknown entity type: ' || p_entity)::TEXT;
    RETURN;
  END IF;
  
  -- Clean entity ID (remove prefix if present)
  v_clean_entity_id := CASE 
    WHEN p_entity_id LIKE '%:%' THEN split_part(p_entity_id, ':', 2)
    ELSE p_entity_id
  END;
  
  -- Insert the operation into ops table
  INSERT INTO ops (op_id, client_id, user_id, ts, entity, entity_id, op_type, payload, base_seq, applied, applied_at)
  VALUES (p_op_id, p_client_id, p_user_id, p_ts, p_entity, v_clean_entity_id, p_op_type, p_payload, p_base_seq, TRUE, NOW())
  RETURNING server_seq INTO v_server_seq;
  
  -- Return success
  RETURN QUERY SELECT v_server_seq, 'success'::TEXT, 'Operation applied successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  -- Log error and return
  RETURN QUERY SELECT 0::BIGINT, 'error'::TEXT, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- 8. Create function to get ops since a given server_seq
CREATE OR REPLACE FUNCTION get_ops_since(
  p_user_id UUID,
  p_since_seq BIGINT,
  p_exclude_client_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 1000
) RETURNS TABLE (
  server_seq BIGINT,
  op_id UUID,
  client_id TEXT,
  ts TIMESTAMPTZ,
  entity TEXT,
  entity_id TEXT,
  op_type TEXT,
  payload JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT o.server_seq, o.op_id, o.client_id, o.ts, o.entity, o.entity_id, o.op_type, o.payload
  FROM ops o
  WHERE o.user_id = p_user_id
    AND o.server_seq > p_since_seq
    AND o.applied = TRUE
    AND (p_exclude_client_id IS NULL OR o.client_id != p_exclude_client_id)
  ORDER BY o.server_seq ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 9. Create function to get latest server_seq for a user
CREATE OR REPLACE FUNCTION get_latest_seq(p_user_id UUID) RETURNS BIGINT AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  SELECT COALESCE(MAX(server_seq), 0) INTO v_seq
  FROM ops
  WHERE user_id = p_user_id AND applied = TRUE;
  
  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- 10. Create view for sync status dashboard
CREATE OR REPLACE VIEW sync_status_view AS
SELECT 
  u.id as user_id,
  u.email,
  COUNT(DISTINCT o.client_id) as device_count,
  COUNT(o.server_seq) as total_ops,
  MAX(o.server_seq) as latest_seq,
  MAX(o.ts) as last_activity,
  COUNT(CASE WHEN o.applied = FALSE THEN 1 END) as pending_ops,
  COUNT(CASE WHEN sc.resolution = 'pending' THEN 1 END) as pending_conflicts
FROM users u
LEFT JOIN ops o ON o.user_id = u.id
LEFT JOIN sync_conflicts sc ON sc.user_id = u.id
GROUP BY u.id, u.email;

-- 11. Add comment documentation
COMMENT ON TABLE ops IS 'Operation log for sync - stores all CRUD operations with server sequence numbers';
COMMENT ON TABLE entity_history IS 'Audit trail storing previous states of entities for rollback capability';
COMMENT ON TABLE sync_clients IS 'Tracks sync state per client device';
COMMENT ON TABLE sync_conflicts IS 'Stores unresolved sync conflicts for manual resolution';
COMMENT ON FUNCTION apply_op IS 'Idempotent function to apply a sync operation';
COMMENT ON FUNCTION get_ops_since IS 'Get operations since a given server sequence number';
COMMENT ON FUNCTION get_latest_seq IS 'Get the latest server sequence number for a user';

-- Done
SELECT 'Migration completed successfully' as status;
