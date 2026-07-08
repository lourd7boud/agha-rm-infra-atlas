/**
 * Pending Operations Store
 * 
 * Manages the queue of operations that need to be synced to the server.
 * Uses IndexedDB via Dexie for persistence.
 */

import { db } from '../../db/database';
import { 
  PendingOperation, 
  OperationStatus, 
  generateOperationId,
  SyncConflict 
} from './types';

// ============================================
// Pending Operations CRUD
// ============================================

/**
 * Add a new pending operation to the queue
 */
export async function addPendingOperation(
  type: PendingOperation['type'],
  entity: PendingOperation['entity'],
  entityId: string,
  payload: any
): Promise<PendingOperation> {
  const operation: PendingOperation = {
    id: generateOperationId(),
    timestamp: Date.now(),
    type,
    entity,
    entityId,
    payload,
    retryCount: 0,
    maxRetries: 3,
    status: 'pending',
    localVersion: Date.now(),
  };

  // Check for existing pending operation on same entity
  const existing = await db.syncOperations
    .where({ entity, entityId })
    .and(op => !op.synced)
    .first();

  if (existing) {
    // Merge operations intelligently
    if (type === 'DELETE') {
      // DELETE supersedes any previous operation
      await db.syncOperations.delete(existing.id);
    } else if (existing.type === 'CREATE' && type === 'UPDATE') {
      // UPDATE after CREATE = keep as CREATE with new data
      await db.syncOperations.update(existing.id, {
        data: payload,
        timestamp: Date.now(),
      });
      return operation;
    } else if (existing.type === 'UPDATE' && type === 'UPDATE') {
      // Multiple UPDATEs = keep latest
      await db.syncOperations.update(existing.id, {
        data: payload,
        timestamp: Date.now(),
      });
      return operation;
    }
  }

  // Store in syncOperations table
  await db.syncOperations.add({
    id: operation.id,
    userId: payload.userId || 'anonymous',
    deviceId: getDeviceId(),
    type: operation.type,
    entity: operation.entity,
    entityId: operation.entityId,
    data: operation.payload,
    timestamp: operation.timestamp,
    synced: false,
  });

  console.log(`[PendingOps] Added ${type} operation for ${entity}:${entityId}`);
  return operation;
}

/**
 * Get all pending (unsynced) operations
 */
export async function getPendingOperations(): Promise<PendingOperation[]> {
  const operations = await db.syncOperations
    .where('synced')
    .equals(0) // false in IndexedDB
    .toArray();

  return operations.map(op => ({
    id: op.id,
    timestamp: op.timestamp,
    type: op.type,
    entity: op.entity,
    entityId: op.entityId,
    payload: op.data,
    retryCount: 0,
    maxRetries: 3,
    status: 'pending' as OperationStatus,
  }));
}

/**
 * Get pending operations count
 */
export async function getPendingCount(): Promise<number> {
  return await db.syncOperations
    .where('synced')
    .equals(0)
    .count();
}

/**
 * Mark operation as synced
 */
export async function markOperationSynced(operationId: string): Promise<void> {
  await db.syncOperations.update(operationId, {
    synced: true,
    syncedAt: Date.now(),
  });
  console.log(`[PendingOps] Marked operation ${operationId} as synced`);
}

/**
 * Mark operation as failed
 */
export async function markOperationFailed(
  operationId: string, 
  error: string
): Promise<void> {
  const op = await db.syncOperations.get(operationId);
  if (op) {
    // Increment retry count (stored in conflicts field temporarily)
    const retryCount = (op.conflicts as any)?.retryCount || 0;
    await db.syncOperations.update(operationId, {
      conflicts: {
        ...op.conflicts,
        retryCount: retryCount + 1,
        lastError: error,
        lastAttempt: Date.now(),
      },
    });
  }
  console.log(`[PendingOps] Marked operation ${operationId} as failed: ${error}`);
}

/**
 * Remove operation from queue
 */
export async function removeOperation(operationId: string): Promise<void> {
  await db.syncOperations.delete(operationId);
  console.log(`[PendingOps] Removed operation ${operationId}`);
}

/**
 * Clear all synced operations (cleanup)
 */
export async function clearSyncedOperations(): Promise<number> {
  const synced = await db.syncOperations
    .where('synced')
    .equals(1)
    .toArray();
  
  const ids = synced.map(op => op.id);
  await db.syncOperations.bulkDelete(ids);
  
  console.log(`[PendingOps] Cleared ${ids.length} synced operations`);
  return ids.length;
}

/**
 * Get operations for a specific entity
 */
export async function getOperationsForEntity(
  entity: string, 
  entityId: string
): Promise<PendingOperation[]> {
  const operations = await db.syncOperations
    .where({ entity, entityId })
    .toArray();

  return operations.map(op => ({
    id: op.id,
    timestamp: op.timestamp,
    type: op.type,
    entity: op.entity,
    entityId: op.entityId,
    payload: op.data,
    retryCount: (op.conflicts as any)?.retryCount || 0,
    maxRetries: 3,
    status: op.synced ? 'synced' : 'pending' as OperationStatus,
  }));
}

// ============================================
// Device ID Management
// ============================================

const DEVICE_ID_KEY = 'btp_device_id';

function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  
  return deviceId;
}

// ============================================
// Conflict Management
// ============================================

/**
 * Store a sync conflict for later resolution
 */
export async function storeConflict(conflict: SyncConflict): Promise<void> {
  const conflicts = getStoredConflicts();
  conflicts.push(conflict);
  localStorage.setItem('btp_sync_conflicts', JSON.stringify(conflicts));
  console.log(`[PendingOps] Stored conflict for ${conflict.entity}:${conflict.entityId}`);
}

/**
 * Get all unresolved conflicts
 */
export function getUnresolvedConflicts(): SyncConflict[] {
  return getStoredConflicts().filter(c => !c.resolved);
}

/**
 * Resolve a conflict
 */
export function resolveConflict(
  conflictId: string, 
  resolution: SyncConflict['resolution']
): void {
  const conflicts = getStoredConflicts();
  const index = conflicts.findIndex(c => c.id === conflictId);
  
  if (index !== -1) {
    conflicts[index].resolved = true;
    conflicts[index].resolution = resolution;
    conflicts[index].resolvedAt = Date.now();
    conflicts[index].resolvedBy = 'user';
    localStorage.setItem('btp_sync_conflicts', JSON.stringify(conflicts));
    console.log(`[PendingOps] Resolved conflict ${conflictId} with ${resolution}`);
  }
}

function getStoredConflicts(): SyncConflict[] {
  try {
    const data = localStorage.getItem('btp_sync_conflicts');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// ============================================
// Batch Operations
// ============================================

/**
 * Get operations in batches for sync
 */
export async function getOperationBatch(batchSize: number = 50): Promise<PendingOperation[]> {
  const operations = await db.syncOperations
    .where('synced')
    .equals(0)
    .limit(batchSize)
    .sortBy('timestamp');

  return operations.map(op => ({
    id: op.id,
    timestamp: op.timestamp,
    type: op.type,
    entity: op.entity,
    entityId: op.entityId,
    payload: op.data,
    retryCount: (op.conflicts as any)?.retryCount || 0,
    maxRetries: 3,
    status: 'pending' as OperationStatus,
  }));
}

/**
 * Bulk mark operations as synced
 */
export async function bulkMarkSynced(operationIds: string[]): Promise<void> {
  const now = Date.now();
  await db.syncOperations
    .where('id')
    .anyOf(operationIds)
    .modify({ synced: true, syncedAt: now });
  
  console.log(`[PendingOps] Bulk marked ${operationIds.length} operations as synced`);
}
