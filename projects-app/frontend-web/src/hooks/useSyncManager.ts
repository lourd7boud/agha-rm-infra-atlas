/**
 * Sync Manager - Main Export
 */

export { 
  useSyncManager,
  normalizeEntityId,
  cleanEntityId,
  getSyncLogs,
  clearSyncLogs,
  inspectSync,
  pullLatestData,
} from './useSyncManagerCore';

export type { SyncStatus } from './useSyncManagerCore';
