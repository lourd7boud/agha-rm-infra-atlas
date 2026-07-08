/**
 * Enhanced Sync Service v2 - Ops-Log Pattern
 * 
 * Features:
 * - Server sequence-based sync
 * - Exponential backoff with jitter
 * - Idempotent operations
 * - Queue management
 * - Conflict detection
 */

import { db, SyncOperation } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

// ==================== CONFIGURATION ====================

const SYNC_CONFIG = {
  // Batch settings
  BATCH_SIZE: 50,
  MAX_BATCH_SIZE: 100,
  
  // Retry settings
  INITIAL_RETRY_DELAY: 1000,      // 1 second
  MAX_RETRY_DELAY: 64000,         // 64 seconds
  MAX_RETRIES: 10,
  JITTER_FACTOR: 0.3,             // 30% jitter
  
  // Sync intervals
  AUTO_SYNC_INTERVAL: 5 * 60 * 1000,  // 5 minutes
  QUICK_SYNC_DELAY: 1000,             // 1 second after coming online
  
  // Storage keys
  DEVICE_ID_KEY: 'sync-device-id',
  SERVER_SEQ_KEY: 'sync-server-seq',
  LAST_SYNC_KEY: 'lastSyncTimestamp',
  RETRY_STATE_KEY: 'sync-retry-state',
};

// ==================== DEVICE ID ====================

/**
 * Detect if running in Electron
 */
const isElectron = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.navigator.userAgent.includes('Electron') || 
         window.location.protocol === 'app:' ||
         (window as any).electronAPI !== undefined;
};

/**
 * Get or generate a unique device ID
 */
export const getDeviceId = (): string => {
  const storageKey = isElectron() 
    ? `${SYNC_CONFIG.DEVICE_ID_KEY}-electron` 
    : `${SYNC_CONFIG.DEVICE_ID_KEY}-browser`;
  
  let deviceId = localStorage.getItem(storageKey);
  if (!deviceId) {
    deviceId = `${isElectron() ? 'electron' : 'browser'}-${uuidv4()}`;
    localStorage.setItem(storageKey, deviceId);
    console.log('🔑 Generated new deviceId:', deviceId);
  }
  return deviceId;
};

// ==================== SERVER SEQUENCE ====================

/**
 * Get the last known server sequence number
 */
export const getServerSeq = (): number => {
  const seq = localStorage.getItem(SYNC_CONFIG.SERVER_SEQ_KEY);
  return seq ? parseInt(seq, 10) : 0;
};

/**
 * Update the server sequence number
 */
export const setServerSeq = (seq: number): void => {
  localStorage.setItem(SYNC_CONFIG.SERVER_SEQ_KEY, seq.toString());
};

// ==================== LAST SYNC TIMESTAMP (Legacy) ====================

/**
 * Get the last sync timestamp (for backward compatibility)
 */
export const getLastSyncTimestamp = (): number => {
  const lastSync = localStorage.getItem(SYNC_CONFIG.LAST_SYNC_KEY);
  return lastSync ? parseInt(lastSync, 10) : 0;
};

/**
 * Update the last sync timestamp
 */
export const setLastSyncTimestamp = (timestamp: number): void => {
  localStorage.setItem(SYNC_CONFIG.LAST_SYNC_KEY, timestamp.toString());
};

// ==================== RETRY STATE ====================

interface RetryState {
  retryCount: number;
  lastRetryTime: number;
  nextRetryDelay: number;
}

/**
 * Get retry state
 */
const getRetryState = (): RetryState => {
  const state = localStorage.getItem(SYNC_CONFIG.RETRY_STATE_KEY);
  if (state) {
    return JSON.parse(state);
  }
  return { retryCount: 0, lastRetryTime: 0, nextRetryDelay: SYNC_CONFIG.INITIAL_RETRY_DELAY };
};

/**
 * Update retry state
 */
const setRetryState = (state: RetryState): void => {
  localStorage.setItem(SYNC_CONFIG.RETRY_STATE_KEY, JSON.stringify(state));
};

/**
 * Reset retry state after successful sync
 */
const resetRetryState = (): void => {
  localStorage.removeItem(SYNC_CONFIG.RETRY_STATE_KEY);
};

/**
 * Calculate next retry delay with exponential backoff and jitter
 */
const calculateNextRetryDelay = (currentDelay: number): number => {
  // Double the delay, but cap at MAX_RETRY_DELAY
  let nextDelay = Math.min(currentDelay * 2, SYNC_CONFIG.MAX_RETRY_DELAY);
  
  // Add jitter (±30%)
  const jitter = nextDelay * SYNC_CONFIG.JITTER_FACTOR;
  nextDelay = nextDelay + (Math.random() * 2 - 1) * jitter;
  
  return Math.round(nextDelay);
};

// ==================== OPERATION LOGGING ====================

/**
 * Log a sync operation to the local queue
 */
export const logSyncOperation = async (
  type: 'CREATE' | 'UPDATE' | 'DELETE',
  entity: SyncOperation['entity'],
  entityId: string,
  data: any,
  userId: string
): Promise<string> => {
  const opId = uuidv4();
  
  const operation: SyncOperation = {
    id: opId,
    userId,
    deviceId: getDeviceId(),
    type,
    entity,
    entityId,
    data,
    timestamp: Date.now(),
    synced: false,
  };

  await db.syncOperations.add(operation);
  console.log(`📝 Logged ${type} operation for ${entity}:${entityId} (op_id: ${opId})`);
  
  return opId;
};

// ==================== PENDING OPERATIONS ====================

/**
 * Get all pending (unsynced) operations
 */
export const getPendingSyncOperations = async (
  userId: string
): Promise<SyncOperation[]> => {
  // Get all operations where synced is false or undefined
  const allOps = await db.syncOperations.toArray();
  return allOps
    .filter(op => !op.synced && op.userId === userId)
    .sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Get count of pending operations
 */
export const getPendingOperationCount = async (userId: string): Promise<number> => {
  const pending = await getPendingSyncOperations(userId);
  return pending.length;
};

/**
 * Mark operations as synced
 */
export const markOperationsAsSynced = async (operationIds: string[]): Promise<void> => {
  const now = Date.now();
  for (const id of operationIds) {
    await db.syncOperations.update(id, { 
      synced: true, 
      syncedAt: now 
    });
  }
  console.log(`✅ Marked ${operationIds.length} operations as synced`);
};

/**
 * Delete operations from queue
 */
export const deleteOperations = async (operationIds: string[]): Promise<void> => {
  for (const id of operationIds) {
    await db.syncOperations.delete(id);
  }
  console.log(`🗑️ Deleted ${operationIds.length} operations from queue`);
};

// ==================== CLEANUP ====================

/**
 * Clean old synced operations (older than 30 days)
 */
export const cleanOldSyncOperations = async (): Promise<number> => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  
  const oldOps = await db.syncOperations
    .where('syncedAt')
    .below(thirtyDaysAgo)
    .and((op) => op.synced === true)
    .toArray();
  
  if (oldOps.length > 0) {
    await db.syncOperations.bulkDelete(oldOps.map(op => op.id));
    console.log(`🧹 Cleaned ${oldOps.length} old sync operations`);
  }
  
  return oldOps.length;
};

// ==================== ONLINE STATUS ====================

/**
 * Check if the application is online
 */
export const isOnline = (): boolean => {
  return navigator.onLine;
};

/**
 * Setup online/offline listeners
 */
export const setupOnlineListener = (
  onOnline: () => void,
  onOffline: () => void
): (() => void) => {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
};

// ==================== SYNC RETRY MANAGER ====================

let retryTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a sync retry with exponential backoff
 */
export const scheduleRetry = (syncFn: () => Promise<void>): void => {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }
  
  const state = getRetryState();
  
  if (state.retryCount >= SYNC_CONFIG.MAX_RETRIES) {
    console.log('❌ Max retries reached, stopping automatic retry');
    return;
  }
  
  const delay = state.nextRetryDelay;
  console.log(`⏳ Scheduling sync retry in ${delay}ms (attempt ${state.retryCount + 1}/${SYNC_CONFIG.MAX_RETRIES})`);
  
  retryTimeout = setTimeout(async () => {
    try {
      await syncFn();
      resetRetryState();
    } catch (error) {
      const newState: RetryState = {
        retryCount: state.retryCount + 1,
        lastRetryTime: Date.now(),
        nextRetryDelay: calculateNextRetryDelay(delay),
      };
      setRetryState(newState);
      scheduleRetry(syncFn);
    }
  }, delay);
};

/**
 * Cancel any pending retry
 */
export const cancelRetry = (): void => {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
};

// ==================== ID NORMALIZATION ====================

/**
 * Normalize an entity ID (ensure consistent format)
 */
export const normalizeEntityId = (entity: string, id: string): string => {
  if (!id) return id;
  
  // Remove existing prefix if present
  const cleanId = id.includes(':') ? id.split(':').pop()! : id;
  
  // Add correct prefix based on entity
  return `${entity}:${cleanId}`;
};

/**
 * Clean an entity ID (remove prefix)
 */
export const cleanEntityId = (id: string): string => {
  if (!id) return id;
  return id.includes(':') ? id.split(':').pop()! : id;
};

// ==================== EXPORT CONFIG ====================

export { SYNC_CONFIG };
