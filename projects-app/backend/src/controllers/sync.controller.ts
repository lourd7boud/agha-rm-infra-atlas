import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Enhanced Sync Controller v2 - Ops-Log Pattern
 * 
 * Features:
 * - Server sequence numbers for reliable ordering
 * - Idempotent operations (duplicate detection via op_id)
 * - Proper conflict detection and resolution
 * - Transaction safety
 * - Detailed logging
 */

// ==================== HELPER FUNCTIONS ====================

/**
 * Convert snake_case to camelCase and format dates
 */
import { keysToCamel, camelToSnake, cleanPrefixedId } from '../utils/transform';

// Alias for backward compat within this file
const snakeToCamel = keysToCamel;

/**
 * Clean entity ID (remove prefix like "project:", "bordereau:", etc.)
 */
const cleanEntityId = cleanPrefixedId;

/**
 * Clean operation ID (remove prefix like "sync:", "op:", etc.)
 */
const cleanOpId = cleanPrefixedId;

/**
 * Map entity type to table name
 */
const getTableName = (entity: string): string | null => {
  const tableMap: Record<string, string> = {
    project: 'projects',
    bordereau: 'bordereaux',
    periode: 'periodes',
    metre: 'metres',
    decompt: 'decompts',
    attachment: 'attachments',
    photo: 'photos',
    pv: 'pvs',
    company: 'companies',
  };
  return tableMap[entity] || null;
};

/**
 * Map table name back to entity type
 */
const getEntityType = (tableName: string): string => {
  const entityMap: Record<string, string> = {
    projects: 'project',
    bordereaux: 'bordereau',
    periodes: 'periode',
    metres: 'metre',
    decompts: 'decompt',
    attachments: 'attachment',
    photos: 'photo',
    pvs: 'pv',
    companies: 'company',
  };
  return entityMap[tableName] || tableName;
};

// Allowed columns per table (to prevent SQL injection and invalid columns)
const ALLOWED_COLUMNS: Record<string, string[]> = {
  projects: [
    'objet', 'marche_no', 'annee', 'date_ouverture', 'montant', 'type_marche', 
    'commune', 'societe', 'rc', 'cb', 'cnss', 'patente', 'programme', 'projet', 
    'ligne', 'chapitre', 'delais_execution', 'osc', 'date_reception_provisoire', 
    'date_reception_definitive', 'achevement_travaux', 'status', 'progress', 
    'folder_path', 'arrets', 'ordre_service'
  ],
  bordereaux: [
    'project_id', 'user_id', 'reference', 'designation', 'lignes', 'montant_total'
  ],
  periodes: [
    'project_id', 'user_id', 'numero', 'libelle', 'date_debut', 'date_fin', 
    'statut', 'is_decompte_dernier', 'observations', 'taux_tva', 'taux_retenue',
    'depenses_exercices_anterieurs', 'decomptes_precedents'
  ],
  metres: [
    'project_id', 'periode_id', 'bordereau_ligne_id', 'user_id', 'reference',
    'designation_bordereau', 'unite', 'sections', 'sub_sections', 'lignes', 
    'total_partiel', 'total_cumule', 'quantite_bordereau', 'pourcentage_realisation'
  ],
  decompts: [
    'project_id', 'periode_id', 'user_id', 'numero', 'lignes', 'montant_total',
    'total_ttc', 'statut'
  ],
  attachments: [
    'project_id', 'user_id', 'file_name', 'file_path', 'file_size', 'mime_type',
    'category', 'description', 'linked_to', 'local_path', 'sync_status'
  ],
  photos: [
    'project_id', 'user_id', 'file_name', 'file_path', 'file_size', 'mime_type',
    'description', 'tags', 'latitude', 'longitude', 'local_path', 'sync_status'
  ],
  pvs: [
    'project_id', 'user_id', 'type', 'numero', 'date', 'objet', 'contenu',
    'participants', 'attachments'
  ],
  companies: [
    'user_id', 'nom', 'rc', 'cb', 'cnss', 'patente', 'adresse', 'telephone',
    'email', 'usage_count', 'last_used'
  ],
};

/**
 * Filter and convert payload to database columns
 */
const preparePayloadForDb = (tableName: string, payload: any, userId: string): Record<string, any> => {
  const allowed = ALLOWED_COLUMNS[tableName] || [];
  const result: Record<string, any> = {};
  
  // Date columns that should be NULL if empty
  const dateColumns = ['date_ouverture', 'date_debut', 'date_fin', 'date_reception_provisoire', 'date_reception_definitive', 'osc'];
  
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    
    const snakeKey = camelToSnake(key);
    
    // Skip system fields
    if (['id', 'user_id', 'created_at', 'updated_at', 'deleted_at', '_id', '_rev', 'version'].includes(snakeKey)) {
      continue;
    }
    
    if (allowed.includes(snakeKey)) {
      // Handle empty strings for date columns - convert to NULL
      if (dateColumns.includes(snakeKey) && (value === '' || value === null)) {
        result[snakeKey] = null;
        continue;
      }
      
      // Skip empty strings for other columns
      if (value === '') {
        continue;
      }
      
      // Clean foreign key IDs
      if (snakeKey.endsWith('_id') && typeof value === 'string' && value.includes(':')) {
        result[snakeKey] = cleanEntityId(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Store objects as JSONB
        result[snakeKey] = JSON.stringify(value);
      } else if (Array.isArray(value)) {
        // Store arrays as JSONB
        result[snakeKey] = JSON.stringify(value);
      } else {
        result[snakeKey] = value;
      }
    }
  }
  
  return result;
};

// ==================== OPERATION APPLICATION ====================

/**
 * Apply a CREATE operation
 */
async function applyCreate(
  client: any, 
  tableName: string, 
  entityId: string, 
  payload: any, 
  userId: string,
  opId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanId = cleanEntityId(entityId);
    const data = preparePayloadForDb(tableName, payload, userId);
    
    if (Object.keys(data).length === 0) {
      logger.warn(`No valid columns to insert for ${tableName}`);
      // Still create the record with just id and user_id
    }

    // 🔒 INTEGRITY CHECK: For decompts, check if duplicate already exists
    if (tableName === 'decompts' && data.project_id && data.periode_id) {
      const dupCheck = await client.query(
        `SELECT id FROM decompts 
         WHERE project_id = $1 AND periode_id = $2 AND deleted_at IS NULL AND id != $3`,
        [data.project_id, data.periode_id, cleanId]
      );
      if (dupCheck.rows.length > 0) {
        // Duplicate exists — update the existing one instead of creating a new one
        const existingId = dupCheck.rows[0].id;
        logger.warn(`🔒 SYNC: Duplicate decompt detected for project=${data.project_id} periode=${data.periode_id}. Updating existing ${existingId} instead of creating ${cleanId}`);
        
        const setClauses = Object.keys(data)
          .map((col, i) => `${col} = $${i + 2}`)
          .join(', ');
        const updateValues = [existingId, ...Object.values(data), opId];
        
        if (setClauses) {
          await client.query(
            `UPDATE decompts SET ${setClauses}, last_op_id = $${updateValues.length}, version = version + 1, updated_at = NOW() WHERE id = $1`,
            updateValues
          );
        }
        return { success: true };
      }
    }

    // 🔒 INTEGRITY CHECK: Same for periodes
    if (tableName === 'periodes' && data.project_id && data.numero) {
      const dupCheck = await client.query(
        `SELECT id FROM periodes 
         WHERE project_id = $1 AND numero = $2 AND deleted_at IS NULL AND id != $3`,
        [data.project_id, data.numero, cleanId]
      );
      if (dupCheck.rows.length > 0) {
        const existingId = dupCheck.rows[0].id;
        logger.warn(`🔒 SYNC: Duplicate periode detected for project=${data.project_id} numero=${data.numero}. Updating existing ${existingId} instead of creating ${cleanId}`);
        
        const setClauses = Object.keys(data)
          .map((col, i) => `${col} = $${i + 2}`)
          .join(', ');
        const updateValues = [existingId, ...Object.values(data), opId];
        
        if (setClauses) {
          await client.query(
            `UPDATE periodes SET ${setClauses}, last_op_id = $${updateValues.length}, version = version + 1, updated_at = NOW() WHERE id = $1`,
            updateValues
          );
        }
        return { success: true };
      }
    }
    
    const columns = ['id', 'user_id', ...Object.keys(data), 'last_op_id', 'version'];
    const values = [cleanId, userId, ...Object.values(data), opId, 1];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    // Build ON CONFLICT clause for upsert
    const updateClauses = Object.keys(data)
      .map((col, i) => `${col} = $${i + 3}`)
      .join(', ');
    
    let query = `
      INSERT INTO ${tableName} (${columns.join(', ')}, created_at, updated_at)
      VALUES (${placeholders}, NOW(), NOW())
    `;
    
    if (updateClauses) {
      query += ` ON CONFLICT (id) DO UPDATE SET ${updateClauses}, last_op_id = $${values.length - 1}, version = ${tableName}.version + 1, updated_at = NOW()`;
    } else {
      query += ` ON CONFLICT (id) DO NOTHING`;
    }
    
    await client.query(query, values);
    logger.info(`✅ CREATE applied: ${tableName}/${cleanId}`);
    
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ CREATE failed for ${tableName}/${entityId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Apply an UPDATE operation
 */
async function applyUpdate(
  client: any, 
  tableName: string, 
  entityId: string, 
  payload: any,
  opId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanId = cleanEntityId(entityId);
    const data = preparePayloadForDb(tableName, payload, userId);
    
    if (Object.keys(data).length === 0) {
      logger.warn(`No valid columns to update for ${tableName}/${cleanId}`);
      return { success: true }; // Consider as success since there's nothing to update
    }
    
    // First try to update
    const setClauses = Object.keys(data)
      .map((col, i) => `${col} = $${i + 2}`)
      .join(', ');
    
    const values = [cleanId, ...Object.values(data), opId];
    
    const updateQuery = `
      UPDATE ${tableName} 
      SET ${setClauses}, last_op_id = $${values.length}, version = version + 1, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `;
    
    const result = await client.query(updateQuery, values);
    
    if (result.rowCount === 0) {
      // Entity doesn't exist - create it via UPSERT
      logger.info(`UPDATE: Entity not found for ${tableName}/${cleanId}, creating via upsert...`);
      
      const columns = ['id', 'user_id', ...Object.keys(data), 'last_op_id', 'version'];
      const insertValues = [cleanId, userId, ...Object.values(data), opId, 1];
      const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
      
      const updateClausesInsert = Object.keys(data)
        .map((col, i) => `${col} = $${i + 3}`)
        .join(', ');
      
      const upsertQuery = `
        INSERT INTO ${tableName} (${columns.join(', ')}, created_at, updated_at)
        VALUES (${placeholders}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET ${updateClausesInsert}, last_op_id = $${insertValues.length - 1}, version = ${tableName}.version + 1, updated_at = NOW()
      `;
      
      await client.query(upsertQuery, insertValues);
      logger.info(`✅ UPDATE (upsert) applied: ${tableName}/${cleanId}`);
    } else {
      logger.info(`✅ UPDATE applied: ${tableName}/${cleanId}`);
    }
    
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ UPDATE failed for ${tableName}/${entityId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Apply a DELETE operation (soft delete)
 */
async function applyDelete(
  client: any, 
  tableName: string, 
  entityId: string,
  opId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanId = cleanEntityId(entityId);
    
    const query = `
      UPDATE ${tableName} 
      SET deleted_at = NOW(), last_op_id = $2, version = version + 1, updated_at = NOW()
      WHERE id = $1
    `;
    
    await client.query(query, [cleanId, opId]);
    logger.info(`✅ DELETE applied: ${tableName}/${cleanId}`);
    
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ DELETE failed for ${tableName}/${entityId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ==================== MAIN SYNC ENDPOINTS ====================

/**
 * POST /sync/push
 * Push local operations to server with idempotency and server sequencing
 */
export const syncPushV2 = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const pool = getPool();
  const client = await pool.connect();
  const requestId = uuidv4();
  
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { operations, deviceId, lastPushedSeq } = req.body;
    const clientId = deviceId || 'default';

    if (!operations || !Array.isArray(operations)) {
      throw new ApiError('Invalid operations data', 400);
    }

    logger.info(`[${requestId}] syncPush: Received ${operations.length} ops from client ${clientId}`);

    const results = {
      ackOps: [] as string[],       // Successfully processed op_ids
      serverSeq: 0 as number,       // Latest server sequence after processing
      remoteOps: [] as any[],       // Operations from other clients since lastPushedSeq
      errors: [] as { opId: string; error: string }[],
      conflicts: [] as any[],
    };

    // CRITICAL: Sort operations by entity dependency order
    // Projects must be created before their children (bordereau, periode, metre, decompt)
    const entityOrder: Record<string, number> = {
      'project': 1,
      'company': 1,
      'bordereau': 2,
      'periode': 2,
      'metre': 3,
      'decompt': 3,
      'attachment': 4,
      'photo': 4,
      'pv': 4,
    };
    
    // Sort: CREATE operations first by entity order, then UPDATE, then DELETE
    const sortedOperations = [...operations].sort((a, b) => {
      // CREATE before UPDATE before DELETE
      const typeOrder: Record<string, number> = { 'CREATE': 1, 'UPDATE': 2, 'DELETE': 3 };
      const typeA = typeOrder[a.type] || 2;
      const typeB = typeOrder[b.type] || 2;
      
      if (typeA !== typeB) return typeA - typeB;
      
      // For same operation type, sort by entity dependency
      const orderA = entityOrder[a.entity] || 10;
      const orderB = entityOrder[b.entity] || 10;
      
      return orderA - orderB;
    });
    
    logger.info(`[${requestId}] syncPush: Sorted ${sortedOperations.length} ops by dependency order`);

    // Start transaction
    await client.query('BEGIN');

    try {
      // Process each operation in sorted order
      for (const op of sortedOperations) {
        const rawOpId = op.id || op.opId || uuidv4();
        const opId = cleanOpId(rawOpId); // Clean the op_id to remove any prefix
        const { type, entity, entityId, data, timestamp } = op;
        
        // Check if operation already exists (idempotency)
        const existingOp = await client.query(
          'SELECT server_seq FROM ops WHERE op_id = $1',
          [opId]
        );
        
        if (existingOp.rows.length > 0) {
          // Operation already processed - acknowledge without re-applying
          logger.info(`[${requestId}] Duplicate op detected: ${opId}`);
          results.ackOps.push(rawOpId); // Return the original ID for client tracking
          continue;
        }
        
        // Get table name
        const tableName = getTableName(entity);
        if (!tableName) {
          results.errors.push({ opId: rawOpId, error: `Unknown entity type: ${entity}` });
          continue;
        }
        
        // Clean the entity ID
        const cleanId = cleanEntityId(entityId);
        
        // Check for conflicts on UPDATE/DELETE
        if (type === 'UPDATE' || type === 'DELETE') {
          const existing = await client.query(
            `SELECT id, updated_at, last_op_id FROM ${tableName} WHERE id = $1`,
            [cleanId]
          );
          
          if (existing.rows.length > 0 && existing.rows[0].last_op_id) {
            // Check if there's a more recent operation from another client
            const recentOp = await client.query(
              `SELECT * FROM ops WHERE entity_id = $1 AND entity = $2 AND client_id != $3 
               AND ts > $4 ORDER BY server_seq DESC LIMIT 1`,
              [cleanId, entity, clientId, new Date(timestamp)]
            );
            
            if (recentOp.rows.length > 0) {
              // Potential conflict - for now, use Last Write Wins (LWW)
              logger.warn(`[${requestId}] Potential conflict on ${entity}/${cleanId}, applying LWW`);
            }
          }
        }
        
        // Apply the operation with SAVEPOINT for error recovery
        let applyResult: { success: boolean; error?: string };
        
        // Create savepoint before each operation
        // SECURITY: Sanitize savepoint name — only allow alphanumeric + underscore to prevent SQL injection
        const sanitizedOpId = opId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 63);
        const savepointName = `sp_${sanitizedOpId}`;
        await client.query(`SAVEPOINT ${savepointName}`);
        
        try {
          switch (type) {
            case 'CREATE':
              applyResult = await applyCreate(client, tableName, entityId, data, req.user.id, opId);
              break;
            case 'UPDATE':
              applyResult = await applyUpdate(client, tableName, entityId, data, opId, req.user.id);
              break;
            case 'DELETE':
              applyResult = await applyDelete(client, tableName, entityId, opId);
              break;
            default:
              applyResult = { success: false, error: `Unknown operation type: ${type}` };
          }
          
          if (applyResult.success) {
            // Insert into ops table
            const insertResult = await client.query(
              `INSERT INTO ops (op_id, client_id, user_id, ts, entity, entity_id, op_type, payload, applied, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
               RETURNING server_seq`,
              [opId, clientId, req.user.id, new Date(timestamp), entity, cleanId, type, JSON.stringify(data)]
            );
            
            const serverSeq = insertResult.rows[0].server_seq;
            results.ackOps.push(rawOpId); // Return original ID for client tracking
            results.serverSeq = Math.max(results.serverSeq, serverSeq);
            
            // Release savepoint on success
            await client.query(`RELEASE SAVEPOINT ${savepointName}`);
            logger.info(`[${requestId}] Op ${opId} applied with server_seq ${serverSeq}`);
          } else {
            // Rollback to savepoint on failure
            await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            results.errors.push({ opId: rawOpId, error: applyResult.error || 'Unknown error' });
          }
        } catch (opError: any) {
          // Rollback to savepoint on exception
          await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          logger.error(`[${requestId}] Op ${opId} failed with exception: ${opError.message}`);
          results.errors.push({ opId: rawOpId, error: opError.message });
        }
      }
      
      // Update sync_clients tracking
      await client.query(
        `INSERT INTO sync_clients (client_id, user_id, last_push_at, last_pushed_seq)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (client_id) DO UPDATE SET 
           last_push_at = NOW(), 
           last_pushed_seq = GREATEST(sync_clients.last_pushed_seq, $3),
           updated_at = NOW()`,
        [clientId, req.user.id, results.serverSeq]
      );
      
      // Get remote operations since lastPushedSeq (from other clients)
      if (lastPushedSeq !== undefined) {
        const remoteOpsResult = await client.query(
          `SELECT server_seq, op_id, client_id, ts, entity, entity_id, op_type, payload
           FROM ops 
           WHERE user_id = $1 AND server_seq > $2 AND client_id != $3 AND applied = TRUE
           ORDER BY server_seq ASC
           LIMIT 500`,
          [req.user.id, lastPushedSeq || 0, clientId]
        );
        
        results.remoteOps = remoteOpsResult.rows.map(row => ({
          serverSeq: row.server_seq,
          opId: row.op_id,
          clientId: row.client_id,
          ts: row.ts,
          entity: row.entity,
          entityId: row.entity_id,
          type: row.op_type,
          data: row.payload,
        }));
      }
      
      // Commit transaction
      await client.query('COMMIT');
      
      logger.info(`[${requestId}] syncPush completed: ${results.ackOps.length} acked, ${results.errors.length} errors`);
      if (results.errors.length > 0) {
        logger.warn(`[${requestId}] syncPush errors:`, results.errors);
      }
      
      res.json({
        success: true,
        data: {
          success: results.ackOps,  // Backward compatibility
          ackOps: results.ackOps,
          serverSeq: results.serverSeq,
          remoteOps: results.remoteOps,
          failed: results.errors,
          conflicts: results.conflicts,
        },
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET /sync/pull
 * Pull remote changes since a given server sequence
 */
export const syncPullV2 = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const pool = getPool();
  const requestId = uuidv4();
  
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { since, lastSync, deviceId } = req.query;
    const clientId = (deviceId as string) || 'default';
    
    // Support both 'since' (server_seq) and 'lastSync' (timestamp) for backward compatibility
    let sinceSeq = 0;
    if (since !== undefined) {
      sinceSeq = parseInt(since as string) || 0;
    }
    
    // Handle legacy timestamp-based sync
    let lastSyncTimestamp = 0;
    if (lastSync !== undefined) {
      lastSyncTimestamp = parseInt(lastSync as string) || 0;
    }
    
    logger.info(`[${requestId}] syncPull: since_seq=${sinceSeq}, lastSync=${lastSyncTimestamp}, client=${clientId}`);
    
    const operations: any[] = [];
    
    // If using sequence-based sync (new method)
    if (sinceSeq > 0) {
      // Get user's own operations
      const result = await pool.query(
        `SELECT server_seq, op_id, client_id, ts, entity, entity_id, op_type, payload
         FROM ops 
         WHERE user_id = $1 AND server_seq > $2 AND applied = TRUE
         ORDER BY server_seq ASC
         LIMIT 1000`,
        [req.user.id, sinceSeq]
      );
      
      for (const row of result.rows) {
        operations.push({
          serverSeq: row.server_seq,
          id: row.op_id,
          opId: row.op_id,
          clientId: row.client_id,
          type: row.op_type,
          entity: row.entity,
          entityId: row.entity_id,
          data: row.payload,
          timestamp: new Date(row.ts).getTime(),
        });
      }
      
      // Also get company operations from ALL users (shared companies)
      const companyOps = await pool.query(
        `SELECT server_seq, op_id, client_id, ts, entity, entity_id, op_type, payload
         FROM ops 
         WHERE entity = 'company' AND server_seq > $1 AND applied = TRUE AND user_id != $2
         ORDER BY server_seq ASC
         LIMIT 500`,
        [sinceSeq, req.user.id]
      );
      
      for (const row of companyOps.rows) {
        operations.push({
          serverSeq: row.server_seq,
          id: row.op_id,
          opId: row.op_id,
          clientId: row.client_id,
          type: row.op_type,
          entity: row.entity,
          entityId: row.entity_id,
          data: row.payload,
          timestamp: new Date(row.ts).getTime(),
        });
      }
      
      // Get latest server_seq
      const latestSeqResult = await pool.query(
        'SELECT COALESCE(MAX(server_seq), 0) as latest_seq FROM ops WHERE user_id = $1 AND applied = TRUE',
        [req.user.id]
      );
      
      // Update client's last_pulled_seq
      await pool.query(
        `INSERT INTO sync_clients (client_id, user_id, last_pull_at, last_pulled_seq)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (client_id) DO UPDATE SET 
           last_pull_at = NOW(), 
           last_pulled_seq = $3,
           updated_at = NOW()`,
        [clientId, req.user.id, latestSeqResult.rows[0].latest_seq]
      );
      
      res.json({
        success: true,
        data: {
          operations,
          serverSeq: parseInt(latestSeqResult.rows[0].latest_seq),
          serverTime: Date.now(),
        },
      });
      
    } else {
      // Legacy timestamp-based sync or full sync
      if (lastSyncTimestamp === 0 || lastSyncTimestamp < 1000000000000) {
        // Full sync - return all existing data
        logger.info(`[${requestId}] Full sync requested for user ${req.user.id}`);
        
        // CRITICAL FIX: Get ONLY active projects - NO deleted ones!
        // This prevents DELETE operations from being sent during full sync
        // which was causing projects to disappear
        const projects = await pool.query(
          'SELECT * FROM projects WHERE user_id = $1 AND deleted_at IS NULL',
          [req.user.id]
        );
        
        // Only CREATE operations for active projects
        for (const project of projects.rows) {
          operations.push({
            id: `full-sync-project-${project.id}`,
            type: 'CREATE',
            entity: 'project',
            entityId: project.id,
            data: snakeToCamel(project),
            timestamp: new Date(project.updated_at || project.created_at).getTime(),
          });
        }
        
        // Get all bordereaux
        const bordereaux = await pool.query(
          `SELECT b.* FROM bordereaux b
           INNER JOIN projects p ON b.project_id = p.id
           WHERE p.user_id = $1 AND b.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const bordereau of bordereaux.rows) {
          operations.push({
            id: `full-sync-bordereau-${bordereau.id}`,
            type: 'CREATE',
            entity: 'bordereau',
            entityId: bordereau.id,
            data: snakeToCamel(bordereau),
            timestamp: new Date(bordereau.updated_at || bordereau.created_at).getTime(),
          });
        }
        
        // Get all periodes
        const periodes = await pool.query(
          `SELECT pe.* FROM periodes pe
           INNER JOIN projects p ON pe.project_id = p.id
           WHERE p.user_id = $1 AND pe.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const periode of periodes.rows) {
          operations.push({
            id: `full-sync-periode-${periode.id}`,
            type: 'CREATE',
            entity: 'periode',
            entityId: periode.id,
            data: snakeToCamel(periode),
            timestamp: new Date(periode.updated_at || periode.created_at).getTime(),
          });
        }
        
        // Get all metres
        const metres = await pool.query(
          `SELECT m.* FROM metres m
           INNER JOIN projects p ON m.project_id = p.id
           WHERE p.user_id = $1 AND m.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const metre of metres.rows) {
          operations.push({
            id: `full-sync-metre-${metre.id}`,
            type: 'CREATE',
            entity: 'metre',
            entityId: metre.id,
            data: snakeToCamel(metre),
            timestamp: new Date(metre.updated_at || metre.created_at).getTime(),
          });
        }
        
        // Get all decompts
        const decompts = await pool.query(
          `SELECT d.* FROM decompts d
           INNER JOIN projects p ON d.project_id = p.id
           WHERE p.user_id = $1 AND d.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const decompt of decompts.rows) {
          operations.push({
            id: `full-sync-decompt-${decompt.id}`,
            type: 'CREATE',
            entity: 'decompt',
            entityId: decompt.id,
            data: snakeToCamel(decompt),
            timestamp: new Date(decompt.updated_at || decompt.created_at).getTime(),
          });
        }
        
        // Get all attachments
        const attachments = await pool.query(
          `SELECT a.* FROM attachments a
           INNER JOIN projects p ON a.project_id = p.id
           WHERE p.user_id = $1 AND a.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const attachment of attachments.rows) {
          operations.push({
            id: `full-sync-attachment-${attachment.id}`,
            type: 'CREATE',
            entity: 'attachment',
            entityId: attachment.id,
            data: snakeToCamel(attachment),
            timestamp: new Date(attachment.created_at).getTime(),
          });
        }
        
        // Get all photos
        const photos = await pool.query(
          `SELECT ph.* FROM photos ph
           INNER JOIN projects p ON ph.project_id = p.id
           WHERE p.user_id = $1 AND ph.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const photo of photos.rows) {
          operations.push({
            id: `full-sync-photo-${photo.id}`,
            type: 'CREATE',
            entity: 'photo',
            entityId: photo.id,
            data: snakeToCamel(photo),
            timestamp: new Date(photo.created_at).getTime(),
          });
        }
        
        // Get all PVs
        const pvs = await pool.query(
          `SELECT pv.* FROM pvs pv
           INNER JOIN projects p ON pv.project_id = p.id
           WHERE p.user_id = $1 AND pv.deleted_at IS NULL`,
          [req.user.id]
        );
        
        for (const pv of pvs.rows) {
          operations.push({
            id: `full-sync-pv-${pv.id}`,
            type: 'CREATE',
            entity: 'pv',
            entityId: pv.id,
            data: snakeToCamel(pv),
            timestamp: new Date(pv.updated_at || pv.created_at).getTime(),
          });
        }
        
        // Get ALL companies (shared between all users)
        const companies = await pool.query(
          `SELECT * FROM companies WHERE deleted_at IS NULL`
        );
        
        for (const company of companies.rows) {
          operations.push({
            id: `full-sync-company-${company.id}`,
            type: 'CREATE',
            entity: 'company',
            entityId: company.id,
            data: snakeToCamel(company),
            timestamp: new Date(company.updated_at || company.created_at).getTime(),
          });
        }
        
        logger.info(`[${requestId}] Full sync: returning ${operations.length} operations (including ${companies.rows.length} shared companies)`);
        
      } else {
        // Incremental sync using timestamp (legacy)
        // Try to use ops table first, fall back to sync_operations
        const opsResult = await pool.query(
          `SELECT server_seq, op_id, client_id, ts, entity, entity_id, op_type, payload
           FROM ops 
           WHERE user_id = $1 AND ts > $2 AND applied = TRUE
           ORDER BY server_seq ASC
           LIMIT 1000`,
          [req.user.id, new Date(lastSyncTimestamp)]
        );
        
        if (opsResult.rows.length > 0) {
          for (const row of opsResult.rows) {
            operations.push({
              serverSeq: row.server_seq,
              id: row.op_id,
              type: row.op_type,
              entity: row.entity,
              entityId: row.entity_id,
              data: row.payload,
              timestamp: new Date(row.ts).getTime(),
            });
          }
        } else {
          // Fall back to legacy sync_operations table
          const legacyResult = await pool.query(
            `SELECT id, operation_type as type, table_name, record_id, payload, timestamp
             FROM sync_operations 
             WHERE user_id = $1 
               AND timestamp > $2
               AND client_id != $3
             ORDER BY timestamp ASC
             LIMIT 1000`,
            [req.user.id, lastSyncTimestamp, clientId]
          );
          
          for (const row of legacyResult.rows) {
            operations.push({
              id: row.id,
              type: row.type,
              entity: getEntityType(row.table_name),
              entityId: row.record_id,
              data: row.payload,
              timestamp: row.timestamp,
            });
          }
        }
      }
      
      // Get latest server_seq for response
      const latestSeqResult = await pool.query(
        'SELECT COALESCE(MAX(server_seq), 0) as latest_seq FROM ops WHERE user_id = $1',
        [req.user.id]
      );
      
      res.json({
        success: true,
        data: {
          operations,
          serverSeq: parseInt(latestSeqResult.rows[0].latest_seq) || 0,
          serverTime: Date.now(),
        },
      });
    }
    
  } catch (error) {
    next(error);
  }
};

/**
 * GET /sync/status
 * Get sync status for the current user
 */
export const getSyncStatusV2 = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const pool = getPool();
    const { deviceId } = req.query;
    const clientId = (deviceId as string) || 'default';
    
    // Get total ops count
    const totalOps = await pool.query(
      'SELECT COUNT(*) FROM ops WHERE user_id = $1',
      [req.user.id]
    );
    
    // Get latest server_seq
    const latestSeq = await pool.query(
      'SELECT COALESCE(MAX(server_seq), 0) as latest_seq FROM ops WHERE user_id = $1',
      [req.user.id]
    );
    
    // Get client sync status
    const clientStatus = await pool.query(
      'SELECT last_pushed_seq, last_pulled_seq, last_push_at, last_pull_at FROM sync_clients WHERE client_id = $1',
      [clientId]
    );
    
    // Get pending conflicts
    const pendingConflicts = await pool.query(
      "SELECT COUNT(*) FROM sync_conflicts WHERE user_id = $1 AND resolution = 'pending'",
      [req.user.id]
    );
    
    // Get connected devices
    const devices = await pool.query(
      'SELECT client_id, last_push_at, last_pull_at FROM sync_clients WHERE user_id = $1',
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: {
        totalOperations: parseInt(totalOps.rows[0].count),
        latestServerSeq: parseInt(latestSeq.rows[0].latest_seq),
        clientStatus: clientStatus.rows[0] || null,
        pendingConflicts: parseInt(pendingConflicts.rows[0].count),
        connectedDevices: devices.rows,
        serverTime: Date.now(),
      },
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * POST /sync/conflict/:id
 * Resolve a sync conflict
 */
export const resolveConflictV2 = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const { resolution, mergedData } = req.body;

    if (!['local_wins', 'remote_wins', 'merged'].includes(resolution)) {
      throw new ApiError('Invalid resolution type. Use: local_wins, remote_wins, or merged', 400);
    }

    await client.query('BEGIN');

    // Get the conflict
    const conflictResult = await client.query(
      'SELECT * FROM sync_conflicts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (conflictResult.rows.length === 0) {
      throw new ApiError('Conflict not found', 404);
    }
    
    const conflict = conflictResult.rows[0];
    const tableName = getTableName(conflict.entity);
    
    if (!tableName) {
      throw new ApiError('Unknown entity type', 400);
    }
    
    // Determine the data to apply
    let dataToApply: any;
    if (resolution === 'local_wins') {
      dataToApply = conflict.local_data;
    } else if (resolution === 'remote_wins') {
      dataToApply = conflict.remote_data;
    } else {
      if (!mergedData) {
        throw new ApiError('mergedData is required for merged resolution', 400);
      }
      dataToApply = mergedData;
    }
    
    // Apply the resolution
    const opId = uuidv4();
    await applyUpdate(client, tableName, conflict.entity_id, dataToApply, opId, req.user.id);
    
    // Record the resolution op
    await client.query(
      `INSERT INTO ops (op_id, client_id, user_id, ts, entity, entity_id, op_type, payload, applied, applied_at)
       VALUES ($1, 'conflict-resolution', $2, NOW(), $3, $4, 'UPDATE', $5, TRUE, NOW())`,
      [opId, req.user.id, conflict.entity, conflict.entity_id, JSON.stringify(dataToApply)]
    );
    
    // Update the conflict record
    await client.query(
      `UPDATE sync_conflicts 
       SET resolution = $1, resolved_data = $2, resolved_by = $3, resolved_at = NOW()
       WHERE id = $4`,
      [resolution, JSON.stringify(dataToApply), req.user.id, id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Conflict resolved successfully',
      data: {
        conflictId: id,
        resolution,
        appliedData: dataToApply,
      },
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

/**
 * POST /sync/force-full
 * Force a full re-sync for a client (clears local data indicator)
 */
export const forceFullSync = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const pool = getPool();
    const { deviceId } = req.body;
    const clientId = deviceId || 'default';
    
    // Reset client's sync state
    await pool.query(
      `UPDATE sync_clients SET last_pushed_seq = 0, last_pulled_seq = 0, updated_at = NOW()
       WHERE client_id = $1 AND user_id = $2`,
      [clientId, req.user.id]
    );
    
    res.json({
      success: true,
      message: 'Client sync state reset. Next pull will be a full sync.',
    });
    
  } catch (error) {
    next(error);
  }
};

// Export all functions
export {
  syncPushV2 as syncPush,
  syncPullV2 as syncPull,
  getSyncStatusV2 as getSyncStatus,
  resolveConflictV2 as resolveConflict,
};
