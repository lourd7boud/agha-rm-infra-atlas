/**
 * Hooks Index - Export all custom hooks
 */

// Sync Manager
export { 
  useSyncManager,
  normalizeEntityId,
  cleanEntityId,
  getSyncLogs,
  clearSyncLogs,
  inspectSync,
  pullLatestData,
} from './useSyncManager';
export type { SyncStatus } from './useSyncManager';

// Realtime Sync
export {
  useRealtimeSync,
  useEntityUpdates,
  useDataChanges,
  useRefreshOnChange,
  realtimeEvents,
  REALTIME_EVENTS,
} from './useRealtimeSync';

// Project Realtime Subscription
export { useProjectRealtime } from './useProjectRealtime';

// Data Hooks  
export {
  useProject,
  useProjects,
  useBordereau,
  useBordereaux,
  usePeriodes,
  usePeriode,
  useMetres,
  useMetresByPeriode,
  useDecompts,
  useDecomptsByPeriode,
  useProjectCounts,
  useDataWithFallback,
  normalizeId,
  cleanId,
} from './useDataHooks';
