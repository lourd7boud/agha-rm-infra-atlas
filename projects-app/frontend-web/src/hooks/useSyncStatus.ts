/**
 * Sync Status Hook
 * 
 * Provides sync status and pending operations count to components.
 */

import { useState, useEffect, useCallback } from 'react';
import { SyncState } from '../services/sync/types';
import { 
  getPendingCount, 
  getUnresolvedConflicts 
} from '../services/sync/pendingOpsStore';
import { useNetworkStatus } from './useNetworkStatus';

interface UseSyncStatusReturn extends SyncState {
  refresh: () => Promise<void>;
  isOfflineMode: boolean;
  hasPendingChanges: boolean;
  hasConflicts: boolean;
}

const LAST_SYNC_KEY = 'btp_last_sync';

/**
 * Hook for monitoring sync status
 */
export function useSyncStatus(): UseSyncStatusReturn {
  const { isOnline, status: networkStatus } = useNetworkStatus();
  
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    networkStatus: 'checking',
    lastSyncAt: getLastSyncTime(),
    pendingCount: 0,
    conflictCount: 0,
  });

  // Refresh sync state
  const refresh = useCallback(async () => {
    try {
      const pendingCount = await getPendingCount();
      const conflicts = getUnresolvedConflicts();
      
      setSyncState(prev => ({
        ...prev,
        networkStatus: isOnline ? 'online' : 'offline',
        pendingCount,
        conflictCount: conflicts.length,
        lastSyncAt: getLastSyncTime(),
      }));
    } catch (error) {
      console.error('[SyncStatus] Error refreshing:', error);
    }
  }, [isOnline]);

  // Update on network change
  useEffect(() => {
    setSyncState(prev => ({
      ...prev,
      networkStatus: networkStatus,
    }));
  }, [networkStatus]);

  // Initial load and periodic refresh
  useEffect(() => {
    refresh();
    
    // Refresh every 10 seconds
    const intervalId = setInterval(refresh, 10000);
    
    return () => clearInterval(intervalId);
  }, [refresh]);

  // Listen for sync events
  useEffect(() => {
    const handleSyncEvent = (event: CustomEvent) => {
      const { type, data } = event.detail;
      
      switch (type) {
        case 'sync_start':
          setSyncState(prev => ({ ...prev, status: 'syncing' }));
          break;
        case 'sync_complete':
          setLastSyncTime(Date.now());
          setSyncState(prev => ({ 
            ...prev, 
            status: 'idle',
            lastSyncAt: Date.now(),
          }));
          refresh();
          break;
        case 'sync_error':
          setSyncState(prev => ({ 
            ...prev, 
            status: 'error',
            error: data?.message,
          }));
          break;
        case 'operation_synced':
          refresh();
          break;
        case 'conflict_detected':
          refresh();
          break;
      }
    };

    window.addEventListener('btp-sync', handleSyncEvent as EventListener);
    
    return () => {
      window.removeEventListener('btp-sync', handleSyncEvent as EventListener);
    };
  }, [refresh]);

  return {
    ...syncState,
    refresh,
    isOfflineMode: !isOnline,
    hasPendingChanges: syncState.pendingCount > 0,
    hasConflicts: syncState.conflictCount > 0,
  };
}

// ============================================
// Helper Functions
// ============================================

function getLastSyncTime(): number | null {
  const stored = localStorage.getItem(LAST_SYNC_KEY);
  return stored ? parseInt(stored, 10) : null;
}

function setLastSyncTime(timestamp: number): void {
  localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
}

/**
 * Dispatch a sync event
 */
export function dispatchSyncEvent(
  type: string, 
  data?: any
): void {
  const event = new CustomEvent('btp-sync', {
    detail: { type, data, timestamp: Date.now() },
  });
  window.dispatchEvent(event);
}

export default useSyncStatus;
