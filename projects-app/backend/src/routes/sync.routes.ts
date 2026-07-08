import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  syncPush,
  syncPull,
  getSyncStatus,
  resolveConflict,
  forceFullSync,
} from '../controllers/sync.controller';

const router = Router();
router.use(authenticate);

/**
 * @route   POST /api/sync/push
 * @desc    Push local operations to server (idempotent, with server sequencing)
 * @access  Private
 * @body    { operations: Array<Op>, deviceId: string, lastPushedSeq?: number }
 * @returns { success: boolean, data: { ackOps: string[], serverSeq: number, remoteOps: Array, errors: Array } }
 */
router.post('/push', syncPush);

/**
 * @route   GET /api/sync/pull
 * @desc    Pull remote changes since last sync
 * @access  Private
 * @query   { since?: number (server_seq), lastSync?: number (timestamp), deviceId: string }
 * @returns { success: boolean, data: { operations: Array, serverSeq: number, serverTime: number } }
 */
router.get('/pull', syncPull);

/**
 * @route   GET /api/sync/status
 * @desc    Get sync status for current user
 * @access  Private
 * @query   { deviceId?: string }
 * @returns { success: boolean, data: { totalOperations, latestServerSeq, clientStatus, pendingConflicts, connectedDevices } }
 */
router.get('/status', getSyncStatus);
router.get('/last', getSyncStatus); // Backward compatibility

/**
 * @route   POST /api/sync/conflict/:id
 * @desc    Resolve a sync conflict
 * @access  Private
 * @body    { resolution: 'local_wins' | 'remote_wins' | 'merged', mergedData?: any }
 */
router.post('/conflict/:id', resolveConflict);

/**
 * @route   POST /api/sync/force-full
 * @desc    Force a full re-sync for a client
 * @access  Private
 * @body    { deviceId?: string }
 */
router.post('/force-full', forceFullSync);

export default router;
