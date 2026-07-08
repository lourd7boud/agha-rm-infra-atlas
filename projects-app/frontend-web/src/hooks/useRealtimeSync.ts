/**
 * useRealtimeSync Hook
 * 
 * React hook for managing real-time synchronization
 * 
 * Features:
 * - Automatic connection on mount
 * - Reconnection on auth changes
 * - Project-specific subscriptions
 * - Real-time UI updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { realtimeSync, ConnectionStatus, RealtimeOperation } from '../services/realtimeSync';

// ==================== TYPES ====================

export interface UseRealtimeSyncOptions {
  autoConnect?: boolean;
  projectId?: string;
}

export interface UseRealtimeSyncResult {
  status: ConnectionStatus;
  isConnected: boolean;
  serverSeq: number;
  lastOperation: RealtimeOperation | null;
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  subscribeToProject: (projectId: string) => void;
  unsubscribeFromProject: (projectId: string) => void;
}

// ==================== EVENT BUS ====================

type EventCallback = (data: any) => void;
const eventListeners: Map<string, Set<EventCallback>> = new Map();

/**
 * Global event bus for cross-component updates
 */
export const realtimeEvents = {
  emit(event: string, data: any): void {
    const listeners = eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      }
    }
  },
  
  on(event: string, callback: EventCallback): () => void {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event)!.add(callback);
    
    return () => {
      eventListeners.get(event)?.delete(callback);
    };
  },
  
  off(event: string, callback: EventCallback): void {
    eventListeners.get(event)?.delete(callback);
  },
};

// Event constants
export const REALTIME_EVENTS = {
  PROJECT_UPDATED: 'project:updated',
  BORDEREAU_UPDATED: 'bordereau:updated',
  PERIODE_UPDATED: 'periode:updated',
  METRE_UPDATED: 'metre:updated',
  DECOMPT_UPDATED: 'decompt:updated',
  PHOTO_UPDATED: 'photo:updated',
  PV_UPDATED: 'pv:updated',
  ATTACHMENT_UPDATED: 'attachment:updated',
  DATA_CHANGED: 'data:changed',
};

// ==================== HOOK ====================

export function useRealtimeSync(options: UseRealtimeSyncOptions = {}): UseRealtimeSyncResult {
  const { autoConnect = true, projectId } = options;
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [serverSeq, setServerSeq] = useState(realtimeSync.getServerSeq());
  const [lastOperation, setLastOperation] = useState<RealtimeOperation | null>(null);
  
  const cleanupRef = useRef<(() => void)[]>([]);

  // ==================== CONNECTION ====================

  const connect = useCallback(() => {
    const token = localStorage.getItem('authToken');
    const deviceId = localStorage.getItem('sync-device-id') || 
                     localStorage.getItem('sync-device-id-browser') ||
                     `browser-${Math.random().toString(36).substring(7)}`;
    const userId = JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.user?.id;

    if (!token || !userId) {
      console.log('🚫 Cannot connect: No auth token or user');
      return;
    }

    // Get server URL
    const envUrl = (import.meta as any)?.env?.VITE_API_URL;
    let serverUrl = envUrl || 'http://localhost:3000';
    
    // For production, use the API server
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      serverUrl = window.location.origin;
    }

    // Check if running in Electron - use production URL
    if (window.navigator.userAgent.includes('Electron') || (window as any).electronAPI) {
      serverUrl = 'https://marocinfra.com';
    }

    realtimeSync.connect(serverUrl, token, deviceId, userId);
  }, []);

  const disconnect = useCallback(() => {
    realtimeSync.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    realtimeSync.reconnect();
  }, []);

  // ==================== SUBSCRIPTIONS ====================

  const subscribeToProject = useCallback((pid: string) => {
    realtimeSync.subscribeToProject(pid);
  }, []);

  const unsubscribeFromProject = useCallback((pid: string) => {
    realtimeSync.unsubscribeFromProject(pid);
  }, []);

  // ==================== OPERATION HANDLER ====================

  const handleOperation = useCallback(async (op: RealtimeOperation) => {
    console.log('🔄 Realtime operation received in hook:', op.type, op.entity, op.entityId);
    
    setLastOperation(op);
    setServerSeq(realtimeSync.getServerSeq());

    // Emit entity-specific events
    const eventMap: Record<string, string> = {
      project: REALTIME_EVENTS.PROJECT_UPDATED,
      bordereau: REALTIME_EVENTS.BORDEREAU_UPDATED,
      periode: REALTIME_EVENTS.PERIODE_UPDATED,
      metre: REALTIME_EVENTS.METRE_UPDATED,
      decompt: REALTIME_EVENTS.DECOMPT_UPDATED,
      photo: REALTIME_EVENTS.PHOTO_UPDATED,
      pv: REALTIME_EVENTS.PV_UPDATED,
      attachment: REALTIME_EVENTS.ATTACHMENT_UPDATED,
    };

    const event = eventMap[op.entity];
    if (event) {
      realtimeEvents.emit(event, {
        type: op.type,
        entityId: op.entityId,
        data: op.data,
        timestamp: op.timestamp,
      });
    }

    // Always emit generic data changed event
    realtimeEvents.emit(REALTIME_EVENTS.DATA_CHANGED, {
      entity: op.entity,
      type: op.type,
      entityId: op.entityId,
      data: op.data,
    });
  }, []);

  // ==================== EFFECTS ====================

  // Setup listeners on mount
  useEffect(() => {
    // Status listener
    const unsubStatus = realtimeSync.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });
    cleanupRef.current.push(unsubStatus);

    // Operation listener
    const unsubOp = realtimeSync.onOperation(handleOperation);
    cleanupRef.current.push(unsubOp);

    // Auto-connect if enabled and user is authenticated
    if (autoConnect) {
      const token = localStorage.getItem('authToken');
      if (token) {
        connect();
      }
    }

    // Cleanup on unmount
    return () => {
      for (const cleanup of cleanupRef.current) {
        cleanup();
      }
      cleanupRef.current = [];
    };
  }, [autoConnect, connect, handleOperation]);

  // Subscribe to project when projectId changes
  useEffect(() => {
    if (projectId && status === 'connected') {
      subscribeToProject(projectId);
      return () => unsubscribeFromProject(projectId);
    }
  }, [projectId, status, subscribeToProject, unsubscribeFromProject]);

  // Handle auth changes (reconnect when token changes)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'authToken') {
        if (e.newValue) {
          // Token added or changed - reconnect
          setTimeout(connect, 500);
        } else {
          // Token removed - disconnect
          disconnect();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [connect, disconnect]);

  // Handle online/offline
  useEffect(() => {
    const handleOnline = () => {
      if (status === 'disconnected' || status === 'error') {
        console.log('🌐 Back online, reconnecting...');
        setTimeout(connect, 1000);
      }
    };

    const handleOffline = () => {
      console.log('📴 Went offline');
      setStatus('disconnected');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [status, connect]);

  return {
    status,
    isConnected: status === 'connected',
    serverSeq,
    lastOperation,
    connect,
    disconnect,
    reconnect,
    subscribeToProject,
    unsubscribeFromProject,
  };
}

// ==================== HELPER HOOKS ====================

/**
 * Hook to listen for specific entity updates
 */
export function useEntityUpdates(
  entity: 'project' | 'bordereau' | 'periode' | 'metre' | 'decompt' | 'photo' | 'pv' | 'attachment',
  callback: (data: { type: string; entityId: string; data: any }) => void,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    const eventMap: Record<string, string> = {
      project: REALTIME_EVENTS.PROJECT_UPDATED,
      bordereau: REALTIME_EVENTS.BORDEREAU_UPDATED,
      periode: REALTIME_EVENTS.PERIODE_UPDATED,
      metre: REALTIME_EVENTS.METRE_UPDATED,
      decompt: REALTIME_EVENTS.DECOMPT_UPDATED,
      photo: REALTIME_EVENTS.PHOTO_UPDATED,
      pv: REALTIME_EVENTS.PV_UPDATED,
      attachment: REALTIME_EVENTS.ATTACHMENT_UPDATED,
    };

    const event = eventMap[entity];
    if (!event) return;

    return realtimeEvents.on(event, callback);
  }, [entity, callback, ...deps]);
}

/**
 * Hook to listen for any data changes
 */
export function useDataChanges(
  callback: (data: { entity: string; type: string; entityId: string; data: any }) => void,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    return realtimeEvents.on(REALTIME_EVENTS.DATA_CHANGED, callback);
  }, [callback, ...deps]);
}

/**
 * Hook that triggers a refetch when entity changes
 */
export function useRefreshOnChange(
  entity: 'project' | 'bordereau' | 'periode' | 'metre' | 'decompt' | 'photo' | 'pv' | 'attachment',
  refreshFn: () => void | Promise<void>
): void {
  const refreshFnRef = useRef(refreshFn);
  refreshFnRef.current = refreshFn;

  useEntityUpdates(
    entity,
    useCallback(() => {
      console.log(`🔄 Auto-refreshing ${entity} data...`);
      refreshFnRef.current();
    }, [entity]),
    [entity]
  );
}

export default useRealtimeSync;
