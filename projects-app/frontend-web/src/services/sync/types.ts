/**
 * Sync Types and Interfaces
 * 
 * Shared types for offline sync functionality.
 * Used by both Web and Electron.
 */

// ============================================
// Sync Status Types
// ============================================

export type NetworkStatus = 'online' | 'offline' | 'checking';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export type OperationStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export type ConflictResolution = 'server_wins' | 'local_wins' | 'manual';

// ============================================
// Pending Operation
// ============================================

export interface PendingOperation {
  id: string;
  timestamp: number;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'project' | 'bordereau' | 'periode' | 'metre' | 'decompt' | 'photo' | 'pv' | 'attachment' | 'company' | 'avenant' | 'approval';
  entityId: string;
  payload: any;
  retryCount: number;
  maxRetries: number;
  status: OperationStatus;
  error?: string;
  lastAttempt?: number;
  serverVersion?: number; // For conflict detection
  localVersion?: number;
}

// ============================================
// Sync Conflict
// ============================================

export interface SyncConflict {
  id: string;
  operationId: string;
  entity: string;
  entityId: string;
  localData: any;
  serverData: any;
  localTimestamp: number;
  serverTimestamp: number;
  resolved: boolean;
  resolution?: ConflictResolution;
  resolvedAt?: number;
  resolvedBy?: 'auto' | 'user';
}

// ============================================
// Sync State
// ============================================

export interface SyncState {
  status: SyncStatus;
  networkStatus: NetworkStatus;
  lastSyncAt: number | null;
  pendingCount: number;
  conflictCount: number;
  syncingEntity?: string;
  progress?: number;
  error?: string;
}

// ============================================
// Sync Events
// ============================================

export interface SyncEvent {
  type: 'sync_start' | 'sync_progress' | 'sync_complete' | 'sync_error' | 
        'operation_synced' | 'conflict_detected' | 'network_change';
  timestamp: number;
  data?: any;
}

export type SyncEventHandler = (event: SyncEvent) => void;

// ============================================
// Sync Log Entry
// ============================================

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
}

// ============================================
// Sync Configuration
// ============================================

export interface SyncConfig {
  /** API base URL */
  apiUrl: string;
  
  /** Sync interval in milliseconds (default: 5 minutes) */
  syncInterval: number;
  
  /** Max retry attempts for failed operations */
  maxRetries: number;
  
  /** Retry delay in milliseconds */
  retryDelay: number;
  
  /** Conflict resolution strategy */
  conflictStrategy: ConflictResolution;
  
  /** Enable auto sync on network reconnect */
  autoSyncOnReconnect: boolean;
  
  /** Enable background sync */
  backgroundSync: boolean;
  
  /** Batch size for sync operations */
  batchSize: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  apiUrl: import.meta.env.VITE_API_URL || `${import.meta.env.BASE_URL}api`,
  syncInterval: 5 * 60 * 1000, // 5 minutes
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  conflictStrategy: 'server_wins',
  autoSyncOnReconnect: true,
  backgroundSync: true,
  batchSize: 50,
};

// ============================================
// Helper Functions
// ============================================

export function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
}

export function getPlatform(): 'web' | 'electron' {
  return isElectron() ? 'electron' : 'web';
}
