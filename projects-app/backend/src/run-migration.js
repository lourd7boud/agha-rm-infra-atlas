/**
 * Run Sync Migration Script
 * 
 * This script applies the ops-log migration to the PostgreSQL database.
 * Run this before deploying the new sync system.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'btpdb',
  user: process.env.POSTGRES_USER || 'btpuser',
  password: process.env.POSTGRES_PASSWORD || 'BtpSecure2025!',
};

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║         Sync System Migration - Ops-Log Pattern           ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log('Configuration:');
console.log(`  Host: ${config.host}`);
console.log(`  Port: ${config.port}`);
console.log(`  Database: ${config.database}`);
console.log(`  User: ${config.user}`);
console.log('');

async function runMigration() {
  const pool = new Pool(config);
  
  try {
    console.log('📦 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    console.log('');
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', 'ops-log-migration.sql');
    console.log(`📄 Reading migration file: ${migrationPath}`);
    
    let migrationSQL;
    try {
      migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    } catch (err) {
      // If file not found, use embedded migration
      console.log('⚠️  Migration file not found, using embedded migration...');
      migrationSQL = getEmbeddedMigration();
    }
    
    console.log('');
    console.log('🚀 Running migration...');
    console.log('');
    
    // Split into statements and execute
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const statement of statements) {
      if (statement.includes('SELECT') && statement.includes('status')) {
        continue; // Skip final SELECT statement
      }
      
      try {
        await client.query(statement);
        successCount++;
        
        // Log progress for CREATE/ALTER statements
        if (statement.includes('CREATE TABLE')) {
          const match = statement.match(/CREATE TABLE[^(]+(\w+)/i);
          if (match) console.log(`  ✅ Created table: ${match[1]}`);
        } else if (statement.includes('CREATE INDEX')) {
          const match = statement.match(/CREATE INDEX[^(]+(\w+)/i);
          if (match) console.log(`  ✅ Created index: ${match[1]}`);
        } else if (statement.includes('ALTER TABLE')) {
          const match = statement.match(/ALTER TABLE\s+(\w+)/i);
          if (match) console.log(`  ✅ Altered table: ${match[1]}`);
        } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
          const match = statement.match(/FUNCTION\s+(\w+)/i);
          if (match) console.log(`  ✅ Created function: ${match[1]}`);
        } else if (statement.includes('CREATE OR REPLACE VIEW')) {
          const match = statement.match(/VIEW\s+(\w+)/i);
          if (match) console.log(`  ✅ Created view: ${match[1]}`);
        }
        
      } catch (err) {
        // Check if it's a "already exists" error
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          skipCount++;
        } else {
          errorCount++;
          console.log(`  ❌ Error: ${err.message.substring(0, 100)}...`);
        }
      }
    }
    
    client.release();
    
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                  MIGRATION COMPLETE                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`  ✅ Successful: ${successCount}`);
    console.log(`  ⏭️  Skipped (already exists): ${skipCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);
    console.log('');
    
    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with some errors. Please review.');
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function getEmbeddedMigration() {
  return `
-- Create the new ops table with server_seq for reliable ordering
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
  base_seq BIGINT,
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ops_client_id ON ops(client_id);
CREATE INDEX IF NOT EXISTS idx_ops_user_id ON ops(user_id);
CREATE INDEX IF NOT EXISTS idx_ops_entity ON ops(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_ts ON ops(ts);
CREATE INDEX IF NOT EXISTS idx_ops_applied ON ops(applied);
CREATE INDEX IF NOT EXISTS idx_ops_server_seq_user ON ops(server_seq, user_id);

-- Create entity_history table for audit trail and rollback
CREATE TABLE IF NOT EXISTS entity_history (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op_id UUID,
  server_seq BIGINT,
  previous_state JSONB,
  new_state JSONB,
  changed_fields TEXT[],
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_history_entity ON entity_history(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_history_changed_at ON entity_history(changed_at);

-- Create sync_clients table to track client sync states
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

-- Create conflicts table for unresolved conflicts
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id BIGSERIAL PRIMARY KEY,
  op_id UUID,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  local_data JSONB NOT NULL,
  remote_data JSONB NOT NULL,
  conflict_type TEXT NOT NULL,
  resolution TEXT,
  resolved_data JSONB,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user ON sync_conflicts(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolution ON sync_conflicts(resolution);

-- Add version columns to main entity tables for optimistic locking
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE bordereaux ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE periodes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE metres ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE metres ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE decompts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE decompts ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE photos ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS last_op_id UUID;

ALTER TABLE pvs ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE pvs ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE pvs ADD COLUMN IF NOT EXISTS last_op_id UUID;
  `;
}

// Run migration
runMigration();
