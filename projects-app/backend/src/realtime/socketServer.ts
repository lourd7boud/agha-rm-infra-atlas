/**
 * Socket.IO Server for Real-time Sync
 * 
 * Features:
 * - Real-time broadcast of sync operations
 * - Room-based subscriptions per user
 * - Automatic reconnection handling
 * - PostgreSQL LISTEN/NOTIFY integration
 */

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { PoolClient } from 'pg';
import { getPool } from '../config/postgres';
import logger from '../utils/logger';
import jwt from 'jsonwebtoken';

// ==================== TYPES ====================

interface AuthenticatedSocket extends Socket {
  userId?: string;
  deviceId?: string;
  clientSessionId?: string;
}

interface SyncOperation {
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

interface NotifyPayload {
  server_seq: number;
  op_id: string;
  client_id: string;
  user_id: string;
  entity: string;
  entity_id: string;
  op_type: string;
  payload: any;
  ts: string;
}

// ==================== SOCKET SERVER ====================

let io: SocketIOServer | null = null;
let pgListenerClient: PoolClient | null = null;
let isListening = false;

/**
 * Initialize Socket.IO server
 */
export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  logger.info('Initializing Socket.IO server...');

  // PHASE 2: Consistent CORS with index.ts
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['https://marocinfra.com', 'https://www.marocinfra.com', 'https://dev.marocinfra.com', 'http://localhost:5173', 'http://localhost:3000'];

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io/',
    // CRITICAL: Stable ping settings to prevent reconnect loops
    pingTimeout: 60000,
    pingInterval: 25000,
    // CRITICAL: Try WebSocket first, fallback to polling only if needed
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    allowUpgrades: true,
    // Increase buffer size for better performance
    maxHttpBufferSize: 1e6,
    // Enable compression for better performance
    perMessageDeflate: false,
  });

  // Authentication middleware
  io.use(async (socket, next: (err?: Error) => void) => {
    try {
      const authSocket = socket as AuthenticatedSocket;
      const token = authSocket.handshake.auth?.token ||
        authSocket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        logger.warn('Socket connection rejected: No token');
        return next(new Error('Authentication required'));
      }

      // PHASE 2: Consistent JWT secret with auth middleware — no insecure default
      const jwtSecret = process.env.JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production';
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256', 'HS384', 'HS512'] }) as { id: string };

      authSocket.userId = decoded.id;
      authSocket.deviceId = authSocket.handshake.auth?.deviceId || 'unknown';
      authSocket.clientSessionId = authSocket.handshake.auth?.clientSessionId || `session-${Date.now()}`;

      logger.info(`Socket authenticated: user=${authSocket.userId}, device=${authSocket.deviceId}, session=${authSocket.clientSessionId}`);
      next();
    } catch (error: any) {
      logger.warn('Socket auth error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  // ─── Presence: Periodic cleanup of stale sessions ───
  setInterval(async () => {
    try {
      const pool = getPool();
      await pool.query(`SELECT cleanup_stale_sessions()`);
    } catch (e) { /* ignore */ }
  }, 60_000); // Every 60 seconds

  // Connection handler
  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // Join user's personal room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      logger.debug(`Socket ${socket.id} joined room: user:${socket.userId}`);

      // ─── Presence: Create session on connect ───
      (async () => {
        try {
          const pool = getPool();
          const { v4: uuidv4 } = require('uuid');
          const ua = socket.handshake.headers['user-agent'] || '';
          await pool.query(
            `INSERT INTO user_sessions (id, user_id, socket_id, device_info, is_active, connected_at, last_heartbeat)
             VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
            [uuidv4(), socket.userId, socket.id, JSON.stringify({ userAgent: ua, deviceId: socket.deviceId })]
          );
          // Broadcast presence update to all clients
          if (io) io.emit('presence:update', { userId: socket.userId, status: 'online' });
        } catch (err) { logger.error('Presence connect error:', err); }
      })();
    }

    // Join project rooms
    socket.on('join:project', (projectId: string) => {
      socket.join(`project:${projectId}`);
      logger.debug(`Socket ${socket.id} joined room: project:${projectId}`);
    });

    socket.on('leave:project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
      logger.debug(`Socket ${socket.id} left room: project:${projectId}`);
    });

    // Subscribe to entity changes
    socket.on('subscribe', (entities: string[]) => {
      for (const entity of entities) {
        socket.join(`entity:${entity}`);
      }
      logger.debug(`Socket ${socket.id} subscribed to entities:`, entities);
    });

    // Request sync state
    socket.on('sync:request', async (data: { since: number }) => {
      try {
        if (!socket.userId) return;

        const pool = getPool();
        const result = await pool.query(
          `SELECT server_seq, op_id, client_id, ts, entity, entity_id, op_type, payload
           FROM ops 
           WHERE user_id = $1 AND server_seq > $2 AND applied = TRUE
           ORDER BY server_seq ASC
           LIMIT 500`,
          [socket.userId, data.since || 0]
        );

        const operations = result.rows.map(row => ({
          serverSeq: row.server_seq,
          opId: row.op_id,
          clientId: row.client_id,
          type: row.op_type,
          entity: row.entity,
          entityId: row.entity_id,
          data: row.payload,
          timestamp: new Date(row.ts).getTime(),
        }));

        socket.emit('sync:state', {
          operations,
          serverTime: Date.now(),
        });

        logger.debug(`Sent ${operations.length} ops to socket ${socket.id}`);
      } catch (error: any) {
        logger.error('Sync request error:', error.message);
        socket.emit('sync:error', { message: error.message });
      }
    });

    // ─── Presence: Heartbeat + Activity tracking ───
    socket.on('presence:heartbeat', async (data: { page?: string; projectId?: string; activity?: string }) => {
      if (!socket.userId) return;
      try {
        const pool = getPool();
        await pool.query(
          `UPDATE user_sessions 
           SET last_heartbeat = NOW(), 
               current_page = COALESCE($1, current_page),
               current_project_id = $2,
               current_activity = COALESCE($3, current_activity)
           WHERE socket_id = $4 AND is_active = true`,
          [data.page || null, data.projectId || null, data.activity || null, socket.id]
        );
      } catch (err) { /* ignore heartbeat errors */ }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (reason: ${reason})`);
      // ─── Presence: Mark session as disconnected ───
      if (socket.userId) {
        (async () => {
          try {
            const pool = getPool();
            await pool.query(
              `UPDATE user_sessions SET is_active = false, disconnected_at = NOW() WHERE socket_id = $1`,
              [socket.id]
            );
            // Broadcast presence update
            if (io) io.emit('presence:update', { userId: socket.userId, status: 'offline' });
          } catch (err) { logger.error('Presence disconnect error:', err); }
        })();
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error (${socket.id}):`, error);
    });
  });

  // Start PostgreSQL listener
  startPgListener();

  logger.info('Socket.IO server ready');

  return io;
};

/**
 * Start PostgreSQL LISTEN for real-time updates
 */
const startPgListener = async (): Promise<void> => {
  if (isListening) {
    logger.info('PG listener already running');
    return;
  }

  try {
    const pool = getPool();
    pgListenerClient = await pool.connect();

    // Set up notification handler
    pgListenerClient.on('notification', (msg) => {
      if (msg.channel === 'ops_channel' && msg.payload) {
        try {
          const payload: NotifyPayload = JSON.parse(msg.payload);
          handleOpsNotification(payload);
        } catch (parseError) {
          logger.error('Error parsing notification payload:', parseError);
        }
      }
    });

    // Subscribe to channel
    await pgListenerClient.query('LISTEN ops_channel');
    isListening = true;

    logger.info('PostgreSQL LISTEN started on ops_channel');

    // Handle connection errors
    pgListenerClient.on('error', async (err) => {
      logger.error('PG listener error:', err);
      isListening = false;
      // Reconnect after delay
      setTimeout(startPgListener, 5000);
    });

  } catch (error: any) {
    logger.error('Failed to start PG listener:', error.message);
    // Retry after delay
    setTimeout(startPgListener, 5000);
  }
};

/**
 * Handle notification from PostgreSQL
 */
const handleOpsNotification = (payload: NotifyPayload): void => {
  if (!io) return;

  const operation: SyncOperation = {
    serverSeq: payload.server_seq,
    opId: payload.op_id,
    clientId: payload.client_id,
    type: payload.op_type as 'CREATE' | 'UPDATE' | 'DELETE',
    entity: payload.entity,
    entityId: payload.entity_id,
    data: payload.payload,
    timestamp: new Date(payload.ts).getTime(),
    userId: payload.user_id,
  };

  // Find sender sockets to exclude (Echo Prevention) - Use clientSessionId
  const senderSockets: string[] = [];
  if (io) {
    const sockets = io.sockets.sockets;
    for (const [id, socket] of sockets) {
      const authSocket = socket as AuthenticatedSocket;
      // Match by userId AND deviceId to prevent echo
      if (authSocket.userId === payload.user_id && authSocket.deviceId === payload.client_id) {
        senderSockets.push(id);
      }
    }
  }
  
  // CRITICAL: If no sender found, this might be a server-initiated DELETE - DO NOT BROADCAST
  if (senderSockets.length === 0 && payload.op_type === 'DELETE') {
    logger.warn(`DELETE operation without sender - BLOCKED: ${operation.opId}`);
    return;
  }

  logger.debug(`Broadcasting op: ${operation.opId} (${operation.type} ${operation.entity}) - Excluded sockets: ${senderSockets.length}`);

  // Broadcast to user's room (excluding the sender's device)
  if (senderSockets.length > 0) {
    io.except(senderSockets).to(`user:${payload.user_id}`).emit('sync:op', operation);
    io.except(senderSockets).to(`entity:${payload.entity}`).emit('sync:op', operation);
  } else {
    io.to(`user:${payload.user_id}`).emit('sync:op', operation);
    io.to(`entity:${payload.entity}`).emit('sync:op', operation);
  }

  // Broadcast to project room if applicable
  if (payload.payload?.projectId || payload.payload?.project_id) {
    const projectId = payload.payload.projectId || payload.payload.project_id;
    if (senderSockets.length > 0) {
      io.except(senderSockets).to(`project:${projectId}`).emit('sync:op', operation);
    } else {
      io.to(`project:${projectId}`).emit('sync:op', operation);
    }
  }

};

/**
 * Broadcast operation to all connected clients
 * Called directly from sync controller when operations are applied
 */
export const broadcastOperation = (
  userId: string,
  operation: Omit<SyncOperation, 'userId'>
): void => {
  if (!io) {
    logger.warn('Socket.IO not initialized, cannot broadcast');
    return;
  }

  const fullOp: SyncOperation = { ...operation, userId };

  logger.debug(`Direct broadcast: ${operation.opId} to user:${userId}`);

  // Broadcast to user's room
  io.to(`user:${userId}`).emit('sync:op', fullOp);

  // Broadcast to entity room
  io.to(`entity:${operation.entity}`).emit('sync:op', fullOp);
};

/**
 * Get connected clients count
 */
export const getConnectedClientsCount = (): number => {
  if (!io) return 0;
  return io.sockets.sockets.size;
};

/**
 * Get connected clients for a user
 */
export const getUserConnectedClients = (userId: string): number => {
  if (!io) return 0;
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return room ? room.size : 0;
};

/**
 * Shutdown socket server
 */
export const shutdownSocketServer = async (): Promise<void> => {
  if (pgListenerClient) {
    await pgListenerClient.query('UNLISTEN ops_channel');
    pgListenerClient.release();
    pgListenerClient = null;
    isListening = false;
  }

  if (io) {
    io.close();
    io = null;
  }

  logger.info('Socket server shut down');
};

export const getIO = (): SocketIOServer | null => io;

export default {
  initSocketServer,
  broadcastOperation,
  getConnectedClientsCount,
  getUserConnectedClients,
  shutdownSocketServer,
  getIO,
};
