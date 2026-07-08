/**
 * PostgreSQL LISTEN/NOTIFY Setup for Real-time Sync
 * 
 * PHASE 2: DDL (CREATE TABLE, ALTER TABLE) moved to migrations/011_realtime_sync_and_indexes.sql
 * This module now only creates/replaces lightweight PL/pgSQL functions and triggers.
 */

import { getPool } from '../config/postgres';
import logger from '../utils/logger';

/**
 * Setup PostgreSQL triggers for real-time notifications.
 * Only creates functions and triggers — no DDL schema changes.
 * Safe to run on every boot (CREATE OR REPLACE + IF NOT EXISTS).
 */
export const setupRealtimeTriggers = async (): Promise<void> => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    logger.info('Setting up PostgreSQL realtime triggers...');

    // Check if ops table exists before creating triggers
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'ops'
      ) AS ops_exists
    `);

    if (!tableCheck.rows[0]?.ops_exists) {
      logger.warn('ops table does not exist yet — skipping trigger setup. Run migrations first.');
      return;
    }

    // Create the NOTIFY function
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_ops_change()
      RETURNS TRIGGER AS $$
      DECLARE
        payload JSON;
      BEGIN
        payload := json_build_object(
          'server_seq', NEW.server_seq,
          'op_id', NEW.op_id,
          'client_id', NEW.client_id,
          'user_id', NEW.user_id,
          'entity', NEW.entity,
          'entity_id', NEW.entity_id,
          'op_type', NEW.op_type,
          'payload', NEW.payload,
          'ts', NEW.ts
        );
        PERFORM pg_notify('ops_channel', payload::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the trigger (idempotent: drop + create)
    await client.query(`
      DROP TRIGGER IF EXISTS ops_notify_trigger ON ops;
      CREATE TRIGGER ops_notify_trigger
        AFTER INSERT ON ops
        FOR EACH ROW
        EXECUTE FUNCTION notify_ops_change();
    `);

    // Helper function: get latest server_seq for a user
    await client.query(`
      CREATE OR REPLACE FUNCTION get_latest_seq(p_user_id UUID)
      RETURNS BIGINT AS $$
      BEGIN
        RETURN COALESCE(
          (SELECT MAX(server_seq) FROM ops WHERE user_id = p_user_id AND applied = TRUE),
          0
        );
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Helper function: clean old ops
    await client.query(`
      CREATE OR REPLACE FUNCTION clean_old_ops(days_to_keep INTEGER DEFAULT 90)
      RETURNS INTEGER AS $$
      DECLARE
        deleted_count INTEGER;
      BEGIN
        DELETE FROM ops
        WHERE ts < NOW() - (days_to_keep || ' days')::INTERVAL
        AND applied = TRUE;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql;
    `);

    logger.info('PostgreSQL realtime triggers setup complete (functions + triggers only)');

  } catch (error: any) {
    logger.error('Error setting up realtime triggers:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Test the notification system
 */
export const testNotification = async (): Promise<boolean> => {
  const pool = getPool();
  
  try {
    // Insert a test operation
    const result = await pool.query(`
      INSERT INTO ops (op_id, client_id, user_id, entity, entity_id, op_type, payload)
      VALUES (
        gen_random_uuid(),
        'test-client',
        '00000000-0000-0000-0000-000000000000',
        'test',
        'test-entity',
        'TEST',
        '{"test": true}'::jsonb
      )
      RETURNING server_seq, op_id
    `);

    logger.info('Test notification sent:', result.rows[0]);
    
    // Clean up test
    await pool.query(`
      DELETE FROM ops WHERE entity = 'test' AND op_type = 'TEST'
    `);

    return true;
  } catch (error: any) {
    logger.error('Test notification failed:', error.message);
    return false;
  }
};

export default {
  setupRealtimeTriggers,
  testNotification,
};
