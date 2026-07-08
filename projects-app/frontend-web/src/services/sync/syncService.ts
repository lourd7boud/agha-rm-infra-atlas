/**
 * Sync Service
 * 
 * Main service for handling synchronization between local IndexedDB and server.
 * Implements offline-first approach with queue-based sync.
 */

import { 
  SyncConfig, 
  DEFAULT_SYNC_CONFIG, 
  PendingOperation,
  SyncConflict,
} from './types';
import {
  getOperationBatch,
  markOperationSynced,
  markOperationFailed,
  storeConflict,
  clearSyncedOperations,
} from './pendingOpsStore';
import { dispatchSyncEvent } from '../../hooks/useSyncStatus';

// ============================================
// Sync Service Class
// ============================================

class SyncService {
  private config: SyncConfig;
  private isSyncing: boolean = false;
  private syncIntervalId: number | null = null;
  private authToken: string | null = null;

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    console.log('[SyncService] Initialized with config:', this.config);
  }

  // ============================================
  // Configuration
  // ============================================

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================
  // Main Sync Logic
  // ============================================

  /**
   * Start the sync service with periodic syncing
   */
  start(): void {
    if (this.syncIntervalId) {
      console.log('[SyncService] Already running');
      return;
    }

    console.log('[SyncService] Starting...');

    // Initial sync
    this.sync();

    // Setup periodic sync
    if (this.config.backgroundSync) {
      this.syncIntervalId = window.setInterval(() => {
        this.sync();
      }, this.config.syncInterval);
    }

    // Listen for online events
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  /**
   * Stop the sync service
   */
  stop(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    console.log('[SyncService] Stopped');
  }

  /**
   * Main sync method - uploads pending operations to server
   */
  async sync(): Promise<{ success: boolean; synced: number; failed: number }> {
    if (this.isSyncing) {
      console.log('[SyncService] Sync already in progress');
      return { success: false, synced: 0, failed: 0 };
    }

    if (!navigator.onLine) {
      console.log('[SyncService] Offline, skipping sync');
      return { success: false, synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    dispatchSyncEvent('sync_start');

    let synced = 0;
    let failed = 0;

    try {
      console.log('[SyncService] Starting sync...');

      // Get pending operations in batches
      const operations = await getOperationBatch(this.config.batchSize);
      
      if (operations.length === 0) {
        console.log('[SyncService] No pending operations');
        dispatchSyncEvent('sync_complete', { synced: 0 });
        return { success: true, synced: 0, failed: 0 };
      }

      console.log(`[SyncService] Syncing ${operations.length} operations...`);

      // Process operations
      for (const operation of operations) {
        try {
          dispatchSyncEvent('sync_progress', { 
            current: synced + failed + 1, 
            total: operations.length,
            entity: operation.entity,
          });

          await this.processOperation(operation);
          await markOperationSynced(operation.id);
          synced++;
          
          dispatchSyncEvent('operation_synced', { operation });
        } catch (error: any) {
          console.error(`[SyncService] Failed to sync operation ${operation.id}:`, error);
          
          // Check for conflict
          if (error.status === 409) {
            await this.handleConflict(operation, error.serverData);
            dispatchSyncEvent('conflict_detected', { operation, error });
          } else {
            await markOperationFailed(operation.id, error.message);
          }
          
          failed++;
        }
      }

      // Cleanup old synced operations
      await clearSyncedOperations();

      // Update last sync time
      localStorage.setItem('btp_last_sync', Date.now().toString());

      console.log(`[SyncService] Sync complete: ${synced} synced, ${failed} failed`);
      dispatchSyncEvent('sync_complete', { synced, failed });

      return { success: true, synced, failed };
    } catch (error: any) {
      console.error('[SyncService] Sync error:', error);
      dispatchSyncEvent('sync_error', { message: error.message });
      return { success: false, synced, failed };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process a single operation
   */
  private async processOperation(operation: PendingOperation): Promise<void> {
    const { type, entity, entityId, payload } = operation;
    
    const endpoint = this.getEndpoint(entity, entityId, type);
    const method = this.getMethod(type);

    const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {}),
      },
      body: type !== 'DELETE' ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error: any = new Error(errorData.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.serverData = errorData;
      throw error;
    }

    return response.json();
  }

  /**
   * Get API endpoint for entity
   */
  private getEndpoint(entity: string, entityId: string, type: string): string {
    const entityEndpoints: Record<string, string> = {
      project: '/projects',
      bordereau: '/bordereaux',
      periode: '/periodes',
      metre: '/metres',
      decompt: '/decompts',
      photo: '/photos',
      pv: '/pvs',
      attachment: '/attachments',
      company: '/companies',
    };

    const base = entityEndpoints[entity] || `/${entity}s`;
    
    if (type === 'CREATE') {
      return base;
    }
    
    return `${base}/${entityId}`;
  }

  /**
   * Get HTTP method for operation type
   */
  private getMethod(type: string): string {
    switch (type) {
      case 'CREATE': return 'POST';
      case 'UPDATE': return 'PUT';
      case 'DELETE': return 'DELETE';
      default: return 'POST';
    }
  }

  /**
   * Handle conflict (server has newer data)
   */
  private async handleConflict(
    operation: PendingOperation, 
    serverData: any
  ): Promise<void> {
    const conflict: SyncConflict = {
      id: `conflict_${Date.now()}`,
      operationId: operation.id,
      entity: operation.entity,
      entityId: operation.entityId,
      localData: operation.payload,
      serverData,
      localTimestamp: operation.timestamp,
      serverTimestamp: serverData.updatedAt ? new Date(serverData.updatedAt).getTime() : Date.now(),
      resolved: false,
    };

    // Auto-resolve based on strategy
    if (this.config.conflictStrategy === 'server_wins') {
      conflict.resolved = true;
      conflict.resolution = 'server_wins';
      conflict.resolvedAt = Date.now();
      conflict.resolvedBy = 'auto';

      // Update local data with server data
      await this.applyServerData(operation.entity, operation.entityId, serverData);
      
      // Mark operation as synced (server data is now local)
      await markOperationSynced(operation.id);
      
      console.log(`[SyncService] Conflict auto-resolved (server wins) for ${operation.entity}:${operation.entityId}`);
    } else {
      // Store conflict for manual resolution
      await storeConflict(conflict);
      console.log(`[SyncService] Conflict stored for manual resolution: ${operation.entity}:${operation.entityId}`);
    }
  }

  /**
   * Apply server data to local database
   */
  private async applyServerData(entity: string, entityId: string, data: any): Promise<void> {
    const { db } = await import('../../db/database');
    
    const tables: Record<string, any> = {
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

    const table = tables[entity];
    if (table) {
      await table.put(data);
      console.log(`[SyncService] Applied server data for ${entity}:${entityId}`);
    }
  }

  // ============================================
  // Event Handlers
  // ============================================

  private handleOnline = (): void => {
    console.log('[SyncService] Network online');
    
    if (this.config.autoSyncOnReconnect) {
      // Delay sync slightly to ensure connection is stable
      setTimeout(() => this.sync(), 2000);
    }
  };

  private handleOffline = (): void => {
    console.log('[SyncService] Network offline');
  };

  // ============================================
  // Pull (Download) from Server
  // ============================================

  /**
   * Pull latest data from server
   */
  async pull(entity: string, since?: number): Promise<any[]> {
    const endpoint = this.getEndpoint(entity, '', 'CREATE');
    const url = new URL(`${this.config.apiUrl}${endpoint}`);
    
    if (since) {
      url.searchParams.set('since', since.toString());
    }

    const response = await fetch(url.toString(), {
      headers: {
        ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to pull ${entity}: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.data || [];
  }

  /**
   * Full sync - pull all data from server
   */
  async fullSync(): Promise<void> {
    console.log('[SyncService] Starting full sync...');
    dispatchSyncEvent('sync_start', { type: 'full' });

    try {
      const entities = ['project', 'bordereau', 'periode', 'metre', 'decompt'];
      
      for (const entity of entities) {
        const data = await this.pull(entity);
        await this.applyBulkServerData(entity, data);
      }

      localStorage.setItem('btp_last_sync', Date.now().toString());
      dispatchSyncEvent('sync_complete', { type: 'full' });
      console.log('[SyncService] Full sync complete');
    } catch (error: any) {
      console.error('[SyncService] Full sync error:', error);
      dispatchSyncEvent('sync_error', { message: error.message, type: 'full' });
      throw error;
    }
  }

  /**
   * Apply bulk server data to local database
   */
  private async applyBulkServerData(entity: string, data: any[]): Promise<void> {
    const { db } = await import('../../db/database');
    
    const tables: Record<string, any> = {
      project: db.projects,
      bordereau: db.bordereaux,
      periode: db.periodes,
      metre: db.metres,
      decompt: db.decompts,
    };

    const table = tables[entity];
    if (table && data.length > 0) {
      await table.bulkPut(data);
      console.log(`[SyncService] Applied ${data.length} ${entity}s from server`);
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

export const syncService = new SyncService();

export default syncService;
