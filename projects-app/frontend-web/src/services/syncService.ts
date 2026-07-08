/**
 * Sync Service - Main Export
 */

export {
  getDeviceId,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  getServerSeq,
  setServerSeq,
  logSyncOperation,
  getPendingSyncOperations,
  markOperationsAsSynced,
  cleanOldSyncOperations,
  isOnline,
  setupOnlineListener,
  normalizeEntityId,
  cleanEntityId,
  SYNC_CONFIG,
} from './syncServiceCore';

