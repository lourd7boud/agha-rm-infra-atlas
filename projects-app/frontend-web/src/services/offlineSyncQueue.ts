/**
 * Offline Sync Queue Handler
 * 
 * Manages the offline sync queue and ensures operations are synced
 * when coming back online. Works with the realtime sync system.
 */

import { db, SyncOperation } from '../db/database';
import { apiService } from './apiService';
import { getDeviceId, setLastSyncTimestamp } from './syncServiceCore';
import { realtimeSync } from './realtimeSync';

// ==================== TYPES ====================

export interface OfflineSyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: Array<{ opId: string; error: string }>;
}

// ==================== CONFIGURATION ====================

const OFFLINE_SYNC_CONFIG = {
  BATCH_SIZE: 25,
  RETRY_DELAY: 2000,
  MAX_RETRIES: 3,
  CONFLICT_STRATEGY: 'last-write-wins' as const,
};

// ==================== OFFLINE QUEUE ====================

/**
 * Get all pending (unsynced) operations for a user
 */
export const getPendingOperations = async (userId: string): Promise<SyncOperation[]> => {
  const allOps = await db.syncOperations.toArray();
  return allOps
    .filter(op => !op.synced && op.userId === userId)
    .sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Get pending operations count
 */
export const getPendingCount = async (userId: string): Promise<number> => {
  const pending = await getPendingOperations(userId);
  return pending.length;
};

/**
 * Mark operations as synced
 */
export const markAsSynced = async (operationIds: string[]): Promise<void> => {
  const now = Date.now();
  await db.transaction('rw', db.syncOperations, async () => {
    for (const id of operationIds) {
      await db.syncOperations.update(id, {
        synced: true,
        syncedAt: now,
      });
    }
  });
  console.log(`✅ Marked ${operationIds.length} operations as synced`);
};

/**
 * Delete synced operations older than specified days
 */
export const cleanOldOperations = async (daysOld: number = 30): Promise<number> => {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  
  const oldOps = await db.syncOperations
    .filter(op => op.synced && (op.syncedAt || 0) < cutoff)
    .toArray();

  if (oldOps.length > 0) {
    await db.syncOperations.bulkDelete(oldOps.map(op => op.id));
    console.log(`🧹 Cleaned ${oldOps.length} old operations`);
  }

  return oldOps.length;
};

// ==================== SYNC OPERATIONS ====================

/**
 * Push pending operations to server
 */
export const pushPendingOperations = async (userId: string): Promise<OfflineSyncResult> => {
  const result: OfflineSyncResult = {
    success: true,
    syncedCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    const pending = await getPendingOperations(userId);
    
    if (pending.length === 0) {
      console.log('📤 No pending operations to push');
      return result;
    }

    console.log(`📤 Pushing ${pending.length} pending operations...`);

    // Process in batches
    for (let i = 0; i < pending.length; i += OFFLINE_SYNC_CONFIG.BATCH_SIZE) {
      const batch = pending.slice(i, i + OFFLINE_SYNC_CONFIG.BATCH_SIZE);
      
      // Transform operations for API
      const transformedOps = batch.map(op => ({
        id: op.id,
        type: op.type,
        entity: op.entity,
        entityId: cleanEntityId(op.entityId),
        data: op.data,
        timestamp: op.timestamp,
      }));

      try {
        // Push to server
        const response = await apiService.syncPush(transformedOps, getDeviceId());
        const ackOps = response.data?.success || response.data?.ackOps || [];
        const failedOps = response.data?.failed || [];

        // Mark successful operations
        if (Array.isArray(ackOps) && ackOps.length > 0) {
          const ackedIds = batch
            .filter(op => ackOps.includes(op.id))
            .map(op => op.id);
          
          await markAsSynced(ackedIds);
          result.syncedCount += ackedIds.length;
        }

        // Handle failed operations
        for (const failed of failedOps) {
          result.errors.push({
            opId: failed.opId,
            error: failed.error,
          });
          result.failedCount++;
        }

        // Update server seq from response
        if (response.data?.serverSeq) {
          realtimeSync.setServerSeq(response.data.serverSeq);
        }

      } catch (batchError: any) {
        console.error('Batch push error:', batchError);
        result.success = false;
        for (const op of batch) {
          result.errors.push({
            opId: op.id,
            error: batchError.message,
          });
          result.failedCount++;
        }
      }
    }

    console.log(`📤 Push complete: ${result.syncedCount} synced, ${result.failedCount} failed`);
    
  } catch (error: any) {
    console.error('Push error:', error);
    result.success = false;
    result.errors.push({ opId: 'general', error: error.message });
  }

  return result;
};

/**
 * Pull latest operations from server
 */
export const pullLatestOperations = async (_userId: string): Promise<number> => {
  try {
    const serverSeq = realtimeSync.getServerSeq();
    console.log(`📥 Pulling operations since seq: ${serverSeq}`);

    const response = await apiService.syncPull(serverSeq, getDeviceId());
    const operations = response.data?.operations || [];
    const newServerSeq = response.data?.serverSeq || serverSeq;
    const serverTime = response.data?.serverTime || Date.now();

    if (operations.length === 0) {
      console.log('📥 No new operations to pull');
      setLastSyncTimestamp(serverTime);
      return 0;
    }

    console.log(`📥 Applying ${operations.length} operations...`);

    // Apply operations to local database
    let appliedCount = 0;
    for (const op of operations) {
      try {
        await applyOperation(op);
        appliedCount++;
      } catch (error: any) {
        console.error(`Failed to apply operation ${op.opId}:`, error);
      }
    }

    // Update tracking
    realtimeSync.setServerSeq(newServerSeq);
    setLastSyncTimestamp(serverTime);

    console.log(`📥 Applied ${appliedCount} of ${operations.length} operations`);
    return appliedCount;

  } catch (error: any) {
    console.error('Pull error:', error);
    throw error;
  }
};

/**
 * Apply a single operation to local database
 */
const applyOperation = async (op: any): Promise<void> => {
  const tableMap: Record<string, any> = {
    project: db.projects,
    bordereau: db.bordereaux,
    periode: db.periodes,
    metre: db.metres,
    decompt: db.decompts,
    photo: db.photos,
    pv: db.pvs,
    attachment: db.attachments,
    company: db.companies,
  };

  const table = tableMap[op.entity];
  if (!table) {
    console.warn('Unknown entity type:', op.entity);
    return;
  }

  const entityId = normalizeEntityId(op.entity, op.entityId);
  const normalizedData = normalizeData(op.entity, op.data, entityId);

  switch (op.type) {
    case 'CREATE':
    case 'UPDATE':
      await table.put(normalizedData);
      break;
    case 'DELETE':
      await table.delete(entityId);
      break;
  }
};

/**
 * Normalize entity ID to include prefix
 */
const normalizeEntityId = (entity: string, id: string): string => {
  if (!id) return '';
  const cleanId = id.includes(':') ? id.split(':').pop()! : id;
  return `${entity}:${cleanId}`;
};

/**
 * Clean entity ID (remove prefix)
 */
const cleanEntityId = (id: string): string => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop()! : id;
};

/**
 * Normalize data with proper ID formats
 */
const normalizeData = (_entity: string, data: any, entityId: string): any => {
  const normalized: any = { ...data, id: entityId };

  // Normalize foreign keys
  if (normalized.projectId) {
    normalized.projectId = normalizeEntityId('project', normalized.projectId);
  }
  if (normalized.periodeId && normalized.periodeId.trim() !== '') {
    normalized.periodeId = normalizeEntityId('periode', normalized.periodeId);
  }
  if (normalized.bordereauId) {
    normalized.bordereauId = normalizeEntityId('bordereau', normalized.bordereauId);
  }
  if (normalized.userId) {
    normalized.userId = normalizeEntityId('user', normalized.userId);
  }

  return normalized;
};

// ==================== FULL SYNC ====================

/**
 * Perform a full sync (push then pull)
 */
export const fullSync = async (userId: string): Promise<{
  pushResult: OfflineSyncResult;
  pullCount: number;
}> => {
  console.log('🔄 Starting full sync...');

  // Push first
  const pushResult = await pushPendingOperations(userId);

  // Then pull
  const pullCount = await pullLatestOperations(userId);

  console.log('🔄 Full sync complete');
  
  return { pushResult, pullCount };
};

/**
 * Handle coming back online
 * Called automatically when the app reconnects
 */
export const handleOnlineRecovery = async (userId: string): Promise<void> => {
  console.log('🌐 Online recovery started...');

  try {
    // 1. Push any pending offline changes
    await pushPendingOperations(userId);

    // 2. Pull any changes we missed
    await pullLatestOperations(userId);

    // 3. Reconnect realtime if not connected
    if (!realtimeSync.isConnected()) {
      const token = localStorage.getItem('authToken');
      const deviceId = getDeviceId();
      
      if (token) {
        let serverUrl = 'http://localhost:3000';
        if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
          serverUrl = window.location.origin;
        }
        if (window.navigator.userAgent.includes('Electron') || (window as any).electronAPI) {
          serverUrl = 'https://marocinfra.com';
        }
        
        realtimeSync.connect(serverUrl, token, deviceId, userId);
      }
    }

    console.log('🌐 Online recovery complete');
  } catch (error: any) {
    console.error('🌐 Online recovery error:', error);
  }
};

// ==================== EXPORTS ====================

export default {
  getPendingOperations,
  getPendingCount,
  markAsSynced,
  cleanOldOperations,
  pushPendingOperations,
  pullLatestOperations,
  fullSync,
  handleOnlineRecovery,
};
