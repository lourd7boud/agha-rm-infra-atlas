/**
 * Realtime Sync Service - WebSocket Client
 * 
 * Features:
 * - Real-time sync via Socket.IO
 * - Automatic reconnection with exponential backoff
 * - Room-based subscriptions
 * - Event-driven updates
 * - Fallback to polling when WebSocket fails
 */

import { io, Socket } from 'socket.io-client';
import { db } from '../db/database';
import { useDirtyStateStore } from '../store/dirtyStateStore';

// ==================== TYPES ====================

export interface RealtimeOperation {
  serverSeq: number;
  opId: string;
  clientId: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  data: any;
  timestamp: number;
  userId: string;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface RealtimeState {
  status: ConnectionStatus;
  lastConnected: number | null;
  reconnectAttempts: number;
  serverSeq: number;
}

type OperationCallback = (op: RealtimeOperation) => void;
type StatusCallback = (status: ConnectionStatus) => void;

// ==================== CONFIGURATION ====================

const REALTIME_CONFIG = {
  RECONNECT_DELAY_MIN: 1000,      // 1 second
  RECONNECT_DELAY_MAX: 30000,     // 30 seconds
  RECONNECT_ATTEMPTS_MAX: 10,
  HEARTBEAT_INTERVAL: 25000,      // 25 seconds
  SERVER_SEQ_KEY: 'realtime-server-seq',
  FALLBACK_POLL_INTERVAL: 3000,   // 3 seconds - fast polling when WebSocket fails
};

// ==================== SOCKET SERVICE ====================

class RealtimeSyncService {
  private socket: Socket | null = null;
  private state: RealtimeState = {
    status: 'disconnected',
    lastConnected: null,
    reconnectAttempts: 0,
    serverSeq: 0,
  };

  private operationListeners: Set<OperationCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
  private token: string | null = null;
  private deviceId: string | null = null;
  private userId: string | null = null;
  private serverUrl: string | null = null;
  private subscribedProjects: Set<string> = new Set();
  
  // 🔴 Flag to skip sync:state after initial full sync
  private lastFullSyncTime: number = 0;
  private static FULL_SYNC_COOLDOWN = 10000; // 10 seconds cooldown after full sync

  constructor() {
    // Load server seq from storage
    const storedSeq = localStorage.getItem(REALTIME_CONFIG.SERVER_SEQ_KEY);
    if (storedSeq) {
      this.state.serverSeq = parseInt(storedSeq, 10) || 0;
    }
  }

  // ==================== CONNECTION ====================

  /**
   * Connect to the realtime server
   */
  connect(serverUrl: string, token: string, deviceId: string, userId: string): void {
    this.token = token;
    this.deviceId = deviceId;
    this.userId = userId;
    this.serverUrl = serverUrl.replace(/\/api\/?$/, ''); // Store base URL without /api

    if (this.socket?.connected) {
      console.log('🔌 Already connected to realtime server');
      return;
    }

    console.log('🔌 Connecting to realtime server:', serverUrl);
    this.updateStatus('connecting');

    // Determine Socket.IO URL - Socket.IO uses HTTP/HTTPS protocol for initial connection
    // Remove /api suffix and use the base URL
    let socketUrl = serverUrl.replace(/\/api\/?$/, '');

    // Ensure proper protocol (Socket.IO handles upgrade to WebSocket internally)
    if (!socketUrl.startsWith('http://') && !socketUrl.startsWith('https://')) {
      socketUrl = `http://${socketUrl}`;
    }

    console.log('🔌 Socket.IO URL:', socketUrl);

    // Generate stable clientSessionId (persists across page reloads)
    const getClientSessionId = () => {
      let sessionId = localStorage.getItem('clientSessionId');
      if (!sessionId) {
        sessionId = `session-${deviceId}-${Date.now()}`;
        localStorage.setItem('clientSessionId', sessionId);
      }
      return sessionId;
    };

    this.socket = io(socketUrl, {
      path: `${(import.meta as any).env?.BASE_URL || '/'}socket.io/`,
      auth: {
        token,
        deviceId,
        clientSessionId: getClientSessionId(), // CRITICAL: Stable session ID
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: REALTIME_CONFIG.RECONNECT_DELAY_MIN,
      reconnectionDelayMax: REALTIME_CONFIG.RECONNECT_DELAY_MAX,
      reconnectionAttempts: REALTIME_CONFIG.RECONNECT_ATTEMPTS_MAX,
      timeout: 20000,
      forceNew: false, // CRITICAL: Reuse connection if possible
    });

    this.setupEventListeners();
  }

  /**
   * Setup socket event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ Connected to realtime server');
      this.updateStatus('connected');
      this.state.lastConnected = Date.now();
      this.state.reconnectAttempts = 0;

      // Stop fallback polling
      this.stopFallbackPolling();

      // Rejoin project rooms
      for (const projectId of this.subscribedProjects) {
        this.socket?.emit('join:project', projectId);
        console.log('📢 Re-joined project room:', projectId);
      }

      // Request missed operations
      this.requestMissedOperations();
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('🔌 Disconnected from realtime server:', reason);
      this.updateStatus('disconnected');

      // Force immediate reconnect attempt if not voluntarily disconnected
      if (reason === 'io server disconnect' || reason === 'transport close') {
        this.socket?.connect();
      }

      // Start fallback polling
      if (reason !== 'io client disconnect') {
        this.startFallbackPolling();
      }
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('❌ Connection error:', error.message);
      this.updateStatus('error');
      this.state.reconnectAttempts++;

      // Start fallback polling after multiple failures
      if (this.state.reconnectAttempts >= 3) {
        this.startFallbackPolling();
      }
    });

    // Sync events
    this.socket.on('sync:op', (operation: RealtimeOperation) => {
      console.log('📥 Received realtime op:', operation.opId, operation.type, operation.entity);
      this.handleOperation(operation);
    });

    this.socket.on('sync:state', (data: { operations: RealtimeOperation[]; serverTime: number }) => {
      console.log('📥 Received sync state:', data.operations.length, 'operations');
      
      // 🔴 Skip if we just did a full sync (to avoid duplicate data application)
      const timeSinceFullSync = Date.now() - this.lastFullSyncTime;
      if (timeSinceFullSync < RealtimeSyncService.FULL_SYNC_COOLDOWN) {
        console.log('⏭️ Skipping sync:state - full sync was done', Math.round(timeSinceFullSync / 1000), 'seconds ago');
        // Still update serverSeq to avoid re-fetching
        if (data.operations.length > 0) {
          const maxSeq = Math.max(...data.operations.map(op => op.serverSeq));
          this.state.serverSeq = Math.max(this.state.serverSeq, maxSeq);
          localStorage.setItem(REALTIME_CONFIG.SERVER_SEQ_KEY, this.state.serverSeq.toString());
        }
        return;
      }
      
      for (const op of data.operations) {
        this.handleOperation(op);
      }
    });

    this.socket.on('sync:error', (error: { message: string }) => {
      console.error('❌ Sync error:', error.message);
    });

    // Error handling
    this.socket.on('error', (error: Error) => {
      console.error('❌ Socket error:', error);
    });
  }

  /**
   * Handle incoming operation
   */
  private async handleOperation(op: RealtimeOperation): Promise<void> {
    // Skip if from same device
    if (op.clientId === this.deviceId) {
      console.log('⏭️ Skipping own operation:', op.opId);
      return;
    }

    // CRITICAL: Block DELETE operations from polling/realtime
    // DELETE should only be applied via direct user action, not sync
    if (op.type === 'DELETE') {
      console.log('🛡️ BLOCKED DELETE from realtime/polling:', op.entity, op.entityId);
      // Update server seq but don't apply the DELETE
      this.state.serverSeq = Math.max(this.state.serverSeq, op.serverSeq);
      localStorage.setItem(REALTIME_CONFIG.SERVER_SEQ_KEY, this.state.serverSeq.toString());
      return;
    }

    // Check if we already have this operation (idempotency)
    if (op.serverSeq <= this.state.serverSeq) {
      console.log('⏭️ Skipping already processed operation:', op.opId);
      return;
    }

    // Apply operation to local database
    await this.applyOperation(op);

    // Update server seq
    this.state.serverSeq = Math.max(this.state.serverSeq, op.serverSeq);
    localStorage.setItem(REALTIME_CONFIG.SERVER_SEQ_KEY, this.state.serverSeq.toString());

    // Notify listeners
    for (const callback of this.operationListeners) {
      try {
        callback(op);
      } catch (error) {
        console.error('Error in operation listener:', error);
      }
    }
  }

  /**
   * Apply operation to local Dexie database
   */
  private async applyOperation(op: RealtimeOperation): Promise<void> {
    // 🔴 التحقق من وجود تغييرات غير محفوظة - تخطي تحديث metres إذا كانت هناك صفحات dirty
    const dirtyState = useDirtyStateStore.getState();
    if (op.entity === 'metre' && dirtyState.hasAnyDirtyPages()) {
      const dirtyPages = dirtyState.getDirtyPages();
      console.log('⚠️ Realtime METRE update skipped: Dirty pages exist:', dirtyPages.map(p => p.pageName).join(', '));
      return;
    }

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

    const entityId = this.normalizeEntityId(op.entity, op.entityId);

    try {
      await db.transaction('rw', [table, db.syncOperations], async () => {
        // 1. Check for pending local operations (Conflict Guard)
        const pendingOps = await db.syncOperations
          .where('entityId')
          .equals(entityId)
          .filter(pending => pending.entity === op.entity && !pending.synced)
          .count();

        if (pendingOps > 0) {
          console.warn(`🛡️ Conflict detected for ${op.entity}:${entityId}. Skipping remote update to preserve local pending changes.`);
          return;
        }

        // 2. Apply operation
        switch (op.type) {
          case 'CREATE':
          case 'UPDATE': {
            const normalizedData = this.normalizeData(op.entity, op.data, entityId);
            await table.put(normalizedData);
            console.log(`✅ Applied ${op.type} to ${op.entity}:${entityId}`);
            break;
          }
          case 'DELETE': {
            await table.delete(entityId);
            console.log(`✅ Applied DELETE to ${op.entity}:${entityId}`);
            break;
          }
        }
      });
    } catch (error: any) {
      console.error(`❌ Failed to apply ${op.type} to ${op.entity}:${entityId}:`, error.message);
    }
  }

  /**
   * Normalize entity ID to include prefix
   */
  private normalizeEntityId(entity: string, id: string): string {
    if (!id) return '';
    const cleanId = id.includes(':') ? id.split(':').pop()! : id;
    return `${entity}:${cleanId}`;
  }

  /**
   * Normalize data with proper ID formats
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private normalizeData(_entity: string, data: any, entityId: string): any {
    const normalized: any = { ...data, id: entityId };

    // Normalize foreign keys
    if (normalized.projectId) {
      normalized.projectId = this.normalizeEntityId('project', normalized.projectId);
    }
    if (normalized.periodeId && normalized.periodeId.trim() !== '') {
      normalized.periodeId = this.normalizeEntityId('periode', normalized.periodeId);
    }
    if (normalized.bordereauId) {
      normalized.bordereauId = this.normalizeEntityId('bordereau', normalized.bordereauId);
    }
    if (normalized.userId) {
      normalized.userId = this.normalizeEntityId('user', normalized.userId);
    }

    return normalized;
  }

  /**
   * Request missed operations since last known sequence
   */
  requestMissedOperations(): void {
    if (!this.socket?.connected) return;

    console.log('📤 Requesting operations since seq:', this.state.serverSeq);
    this.socket.emit('sync:request', { since: this.state.serverSeq });
  }

  // ==================== SUBSCRIPTIONS ====================

  /**
   * Subscribe to project updates
   */
  subscribeToProject(projectId: string): void {
    this.subscribedProjects.add(projectId);
    if (this.socket?.connected) {
      this.socket.emit('join:project', projectId);
      console.log('📢 Subscribed to project:', projectId);
    }
  }

  /**
   * Unsubscribe from project updates
   */
  unsubscribeFromProject(projectId: string): void {
    this.subscribedProjects.delete(projectId);
    if (this.socket?.connected) {
      this.socket.emit('leave:project', projectId);
      console.log('📢 Unsubscribed from project:', projectId);
    }
  }

  // ==================== FALLBACK POLLING ====================

  /**
   * Start fallback polling when WebSocket is unavailable
   */
  private startFallbackPolling(): void {
    if (this.fallbackPollTimer) return;

    console.log('⏰ Starting fallback polling...');

    this.fallbackPollTimer = setInterval(async () => {
      if (this.socket?.connected) {
        this.stopFallbackPolling();
        return;
      }

      await this.pollForUpdates();
    }, REALTIME_CONFIG.FALLBACK_POLL_INTERVAL);
  }

  /**
   * Stop fallback polling
   */
  private stopFallbackPolling(): void {
    if (this.fallbackPollTimer) {
      clearInterval(this.fallbackPollTimer);
      this.fallbackPollTimer = null;
      console.log('⏰ Stopped fallback polling');
    }
  }

  /**
   * Poll server for updates (fallback)
   */
  private async pollForUpdates(): Promise<void> {
    if (!this.token) return;

    try {
      // Use stored server URL for cross-origin requests (e.g., Electron)
      const baseUrl = this.serverUrl || '';
      const mount = ((import.meta as any).env?.BASE_URL || '/');
      const pollUrl = `${baseUrl}${mount}api/sync/pull?since=${this.state.serverSeq}&deviceId=${this.deviceId}`;
      
      const response = await fetch(pollUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const operations = data.data?.operations || [];

        for (const op of operations) {
          await this.handleOperation({
            serverSeq: op.serverSeq,
            opId: op.opId || op.id,
            clientId: op.clientId,
            type: op.type,
            entity: op.entity,
            entityId: op.entityId,
            data: op.data,
            timestamp: op.timestamp,
            userId: op.userId || this.userId || '',
          });
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }

  // ==================== LISTENERS ====================

  /**
   * Add operation listener
   */
  onOperation(callback: OperationCallback): () => void {
    this.operationListeners.add(callback);
    return () => this.operationListeners.delete(callback);
  }

  /**
   * Add status listener
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    // Immediately call with current status
    callback(this.state.status);
    return () => this.statusListeners.delete(callback);
  }

  /**
   * Update and broadcast status
   */
  private updateStatus(status: ConnectionStatus): void {
    this.state.status = status;
    for (const callback of this.statusListeners) {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in status listener:', error);
      }
    }
  }

  // ==================== STATE ====================

  /**
   * Get current state
   */
  getState(): RealtimeState {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Get server sequence
   */
  getServerSeq(): number {
    return this.state.serverSeq;
  }

  /**
   * Set server sequence (after pull)
   */
  setServerSeq(seq: number): void {
    this.state.serverSeq = seq;
    localStorage.setItem(REALTIME_CONFIG.SERVER_SEQ_KEY, seq.toString());
  }

  /**
   * Mark that a full sync was just completed
   * This prevents sync:state from re-applying operations
   */
  markFullSyncComplete(): void {
    this.lastFullSyncTime = Date.now();
    console.log('🔄 Full sync marked complete - will skip sync:state for 10 seconds');
  }

  // ==================== CLEANUP ====================

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    console.log('🔌 Disconnecting from realtime server');

    this.stopFallbackPolling();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.updateStatus('disconnected');
    this.subscribedProjects.clear();
  }

  /**
   * Reconnect to server
   */
  reconnect(): void {
    if (this.token && this.deviceId && this.userId) {
      const serverUrl = this.getServerUrl();
      this.disconnect();
      this.connect(serverUrl, this.token, this.deviceId, this.userId);
    }
  }

  /**
   * Get server URL based on environment
   */
  private getServerUrl(): string {
    // 1. Check Electron context bridge API URL
    if (typeof window !== 'undefined' && (window as any).electron?.apiUrl) {
      const electronApiUrl = (window as any).electron.apiUrl;
      console.log('🔌 [REALTIME] Using Electron API URL:', electronApiUrl);
      return electronApiUrl;
    }
    
    // 2. Check environment variable (Vite)
    const envUrl = (import.meta as any)?.env?.VITE_API_URL;
    if (envUrl) {
      console.log('🌐 [REALTIME] Using VITE_API_URL:', envUrl);
      return envUrl.replace('/api', '');
    }

    // 3. Browser environment
    if (typeof window !== 'undefined') {
      // If running in Electron (app:// or file://)
      if (window.location.protocol === 'app:' || window.location.protocol === 'file:') {
        // HARDCODED PRODUCTION URL FOR ELECTRON
        console.log('🔌 [REALTIME] Electron detected, using production URL');
        return 'http://localhost:5000';
      }

      // If running on localhost (dev)
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Determine port based on frontend port (usually 5173 -> backend 3000/5000)
        console.log('🔧 [REALTIME] Development mode, using localhost');
        return 'http://localhost:5000';
      }

      // If running on a domain (production web)
      return window.location.origin;
    }

    return 'http://localhost:5000';
  }
}

// ==================== SINGLETON EXPORT ====================

export const realtimeSync = new RealtimeSyncService();

// Expose socket for presence system
export function getRealtimeSocket(): Socket | null {
  return (realtimeSync as any).socket;
}

export default realtimeSync;
