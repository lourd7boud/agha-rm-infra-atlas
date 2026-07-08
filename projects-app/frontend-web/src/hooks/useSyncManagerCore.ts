/**
 * Sync Manager V3 - Complete Read Model Fix with Realtime Support
 * 
 * Features:
 * - Ordered operation application (CREATE → UPDATE → DELETE)
 * - Dexie transaction support with bulkPut
 * - Comprehensive error logging
 * - Sync inspector for debugging
 * - Proper ID normalization
 * - Realtime WebSocket integration
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { apiService } from '../services/apiService';
import {
  getDeviceId,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  isOnline,
  setupOnlineListener,
} from '../services/syncService';
import { realtimeSync, RealtimeOperation } from '../services/realtimeSync';
import { realtimeEvents, REALTIME_EVENTS } from './useRealtimeSync';
import { useDirtyStateStore } from '../store/dirtyStateStore';

// ==================== TYPES ====================

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'pulling' | 'realtime';

interface SyncState {
  status: SyncStatus;
  lastSyncTime: number | null;
  pendingOperations: number;
  error: string | null;
  lastPullCount: number;
  realtimeConnected: boolean;
}

interface RemoteOperation {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  data: any;
  timestamp: string | number;
  serverSeq?: number;
}

interface SyncLog {
  timestamp: Date;
  action: string;
  entity?: string;
  entityId?: string;
  success: boolean;
  error?: string;
  data?: any;
}

// ==================== ENTITY MAPPING ====================

const ENTITY_TO_TABLE: Record<string, string> = {
  'project': 'projects',
  'bordereau': 'bordereaux',
  'metre': 'metres',
  'decompt': 'decompts',
  'pv': 'pvs',
  'periode': 'periodes',
  'photo': 'photos',
  'attachment': 'attachments',
  'user': 'users',
  'company': 'companies',
  'auditLog': 'auditLogs',
};

// ==================== ID UTILITIES ====================

/**
 * Normalize entity ID to include prefix (entity:uuid)
 */
export const normalizeEntityId = (entity: string, id: string): string => {
  if (!id) return '';
  const cleanId = id.includes(':') ? id.split(':').pop()! : id;
  return `${entity}:${cleanId}`;
};

/**
 * Clean entity ID (remove prefix)
 */
export const cleanEntityId = (id: string): string => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop()! : id;
};

// ==================== SYNC LOGS ====================

const syncLogs: SyncLog[] = [];
const MAX_LOGS = 500;

const addSyncLog = (log: Omit<SyncLog, 'timestamp'>) => {
  syncLogs.unshift({ ...log, timestamp: new Date() });
  if (syncLogs.length > MAX_LOGS) {
    syncLogs.pop();
  }

  // Also log to console
  const emoji = log.success ? '✅' : '❌';
  console.log(`${emoji} [SYNC] ${log.action}`, log.entity ? `${log.entity}:${log.entityId}` : '', log.error || '');
};

export const getSyncLogs = () => [...syncLogs];
export const clearSyncLogs = () => { syncLogs.length = 0; };

// ==================== SYNC INSPECTOR ====================

export interface SyncInspectorResult {
  localCounts: Record<string, number>;
  missingEntities: { entity: string; id: string }[];
  orphanedEntities: { entity: string; id: string }[];
  errors: string[];
}

/**
 * Compare local Dexie data with server data
 */
export const inspectSync = async (_userId: string): Promise<SyncInspectorResult> => {
  const result: SyncInspectorResult = {
    localCounts: {},
    missingEntities: [],
    orphanedEntities: [],
    errors: [],
  };

  try {
    // Get local counts
    result.localCounts = {
      projects: await db.projects.count(),
      bordereaux: await db.bordereaux.count(),
      metres: await db.metres.count(),
      decompts: await db.decompts.count(),
      periodes: await db.periodes.count(),
      pvs: await db.pvs.count(),
      photos: await db.photos.count(),
      attachments: await db.attachments.count(),
    };

    // Get server data for comparison
    const serverProjects = await apiService.getProjects();
    const projects = serverProjects.data || serverProjects;

    if (Array.isArray(projects)) {
      for (const serverProject of projects) {
        const localId = normalizeEntityId('project', serverProject.id);
        const localProject = await db.projects.get(localId);

        if (!localProject) {
          result.missingEntities.push({ entity: 'project', id: serverProject.id });
        }
      }
    }

    // Check for orphaned local data
    const localProjects = await db.projects.toArray();
    for (const localProject of localProjects) {
      const serverId = cleanEntityId(localProject.id);
      const exists = Array.isArray(projects) && projects.some(p =>
        cleanEntityId(p.id) === serverId || p.id === serverId
      );

      if (!exists && !localProject.deletedAt) {
        result.orphanedEntities.push({ entity: 'project', id: localProject.id });
      }
    }

    addSyncLog({ action: 'INSPECT', success: true, data: result });

  } catch (error: any) {
    result.errors.push(error.message);
    addSyncLog({ action: 'INSPECT', success: false, error: error.message });
  }

  return result;
};

// ==================== OPERATION SORTING ====================

/**
 * Sort operations: CREATE first, then UPDATE, then DELETE
 */
const sortOperations = (operations: RemoteOperation[]): RemoteOperation[] => {
  const typeOrder = { 'CREATE': 0, 'UPDATE': 1, 'DELETE': 2 };

  return [...operations].sort((a, b) => {
    // First by type
    const typeCompare = typeOrder[a.type] - typeOrder[b.type];
    if (typeCompare !== 0) return typeCompare;

    // Then by timestamp
    const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
    const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
    return timeA - timeB;
  });
};

// ==================== APPLY OPERATIONS ====================

/**
 * Apply remote operations with transaction support
 */
const applyRemoteOperations = async (operations: RemoteOperation[]): Promise<{
  applied: number;
  skipped: number;
  errors: { op: RemoteOperation; error: string }[];
}> => {
  const result = { applied: 0, skipped: 0, errors: [] as { op: RemoteOperation; error: string }[] };

  if (operations.length === 0) {
    return result;
  }

  // Sort operations for proper ordering
  const sortedOps = sortOperations(operations);

  console.log(`📥 Applying ${sortedOps.length} operations (sorted: CREATE→UPDATE→DELETE)...`);

  // Filter out conflicts (ops that have local pending changes)
  const nonConflictingOps: RemoteOperation[] = [];

  for (const op of sortedOps) {
    const entityId = normalizeEntityId(op.entity, op.entityId);
    const rawEntityId = cleanEntityId(op.entityId); // ID without prefix

    // CRITICAL: Block DELETE operations from sync pull
    // DELETE should only be applied via direct user action, not sync
    // This prevents data loss when another client deletes data
    if (op.type === 'DELETE') {
      console.log(`🛡️ BLOCKED DELETE from sync pull: ${op.entity}:${entityId}`);
      result.skipped++;
      addSyncLog({ action: 'SKIP_DELETE', entity: op.entity, entityId: op.entityId, success: false, error: 'DELETE blocked from remote sync' });
      continue;
    }

    // Check for pending local sync op
    // 🔴 FIX: Search both with and without prefix since logSyncOperation stores without prefix
    const pendingConflict = await db.syncOperations
      .where('entityId')
      .anyOf([entityId, rawEntityId])
      .filter(p => p.entity === op.entity && !p.synced)
      .count();

    if (pendingConflict > 0) {
      console.warn(`🛡️ Conflict detected for ${op.entity}:${entityId} during PULL. Skipping remote update.`);
      result.skipped++;
      addSyncLog({ action: 'SKIP_CONFLICT', entity: op.entity, entityId: op.entityId, success: false, error: 'Local pending changes exist' });
      continue;
    }

    nonConflictingOps.push(op);
  }

  // Group operations by table for bulk operations
  const opsByTable: Record<string, { creates: any[]; updates: any[]; deletes: string[] }> = {};

  for (const op of nonConflictingOps) {
    const tableName = ENTITY_TO_TABLE[op.entity];
    if (!tableName) {
      result.skipped++;
      addSyncLog({ action: 'SKIP', entity: op.entity, entityId: op.entityId, success: false, error: `Unknown entity: ${op.entity}` });
      continue;
    }

    if (!opsByTable[tableName]) {
      opsByTable[tableName] = { creates: [], updates: [], deletes: [] };
    }

    const entityId = normalizeEntityId(op.entity, op.entityId);

    // Normalize foreign keys
    const normalizedData = op.data ? { ...op.data } : {};

    if (normalizedData.projectId) {
      normalizedData.projectId = normalizeEntityId('project', normalizedData.projectId);
    }
    if (normalizedData.periodeId && String(normalizedData.periodeId).trim() !== '') {
      normalizedData.periodeId = normalizeEntityId('periode', normalizedData.periodeId);
    }
    if (normalizedData.bordereauId) {
      normalizedData.bordereauId = normalizeEntityId('bordereau', normalizedData.bordereauId);
    }

    switch (op.type) {
      case 'CREATE':
        opsByTable[tableName].creates.push({ ...normalizedData, id: entityId });
        break;
      case 'UPDATE':
        opsByTable[tableName].updates.push({ id: entityId, data: normalizedData });
        break;
      case 'DELETE':
        opsByTable[tableName].deletes.push(entityId);
        break;
    }
  }

  // Apply operations using Dexie transaction
  // Note: Dexie.transaction accepts up to 7 tables, so we need to group them
  try {
    const allTables = [
      db.projects,
      db.bordereaux,
      db.metres,
      db.decompts,
      db.periodes,
      db.pvs,
      db.photos
    ];

    await db.transaction('rw', allTables, async () => {
      for (const [tableName, ops] of Object.entries(opsByTable)) {
        const table = (db as any)[tableName];
        if (!table) continue;

        // 🔴 FIX: For CREATE operations, merge with existing local data to prevent data loss
        // This handles the case where server sends old CREATE that would overwrite local changes
        if (ops.creates.length > 0) {
          try {
            // Process each create individually to merge with existing data
            for (const item of ops.creates) {
              try {
                const existingLocal = await table.get(item.id);
                
                if (existingLocal) {
                  // 🔴 CRITICAL: Local data exists - merge carefully
                  // For metres, preserve local sections/subSections/lignes if they exist
                  if (tableName === 'metres') {
                    const mergedData = {
                      ...item,
                      // Preserve local hierarchical data if it exists and server data is empty
                      sections: (item.sections && item.sections.length > 0) ? item.sections : (existingLocal.sections || []),
                      subSections: (item.subSections && item.subSections.length > 0) ? item.subSections : (existingLocal.subSections || []),
                      lignes: (item.lignes && item.lignes.length > 0) ? item.lignes : (existingLocal.lignes || []),
                      // Use the most recent totals
                      totalPartiel: item.totalPartiel || existingLocal.totalPartiel || 0,
                      totalCumule: item.totalCumule || existingLocal.totalCumule || 0,
                    };
                    await table.put(mergedData);
                    console.log(`📦 Merged metre data for ${item.id} - preserved local sections/lignes`);
                  } 
                  // 🔴 FIX: For bordereaux, preserve local lignes with their quantite values
                  else if (tableName === 'bordereaux') {
                    // Check if local lignes have more data (non-zero quantite)
                    const localHasQuantite = existingLocal.lignes?.some((l: any) => l.quantite > 0);
                    const serverHasQuantite = item.lignes?.some((l: any) => l.quantite > 0);
                    
                    const mergedData = {
                      ...item,
                      // Preserve local lignes if they have quantite values and server doesn't
                      lignes: (serverHasQuantite || !localHasQuantite) ? item.lignes : existingLocal.lignes,
                      montantTotal: (serverHasQuantite || !localHasQuantite) ? item.montantTotal : existingLocal.montantTotal,
                    };
                    await table.put(mergedData);
                    console.log(`📦 Merged bordereau data for ${item.id} - preserved local lignes with quantite`);
                  }
                  else {
                    // For other entities, prefer server data but preserve local timestamps
                    await table.put({
                      ...item,
                      updatedAt: item.updatedAt || existingLocal.updatedAt,
                    });
                  }
                } else {
                  // No local data, just add the new item
                  await table.put(item);
                }
                result.applied++;
              } catch (putError: any) {
                result.errors.push({ op: { type: 'CREATE', entity: tableName, entityId: item.id, data: item } as any, error: putError.message });
                addSyncLog({ action: 'CREATE', entity: tableName, entityId: item.id, success: false, error: putError.message });
              }
            }
            addSyncLog({ action: 'BULK_CREATE', entity: tableName, success: true, data: { count: ops.creates.length } });
          } catch (error: any) {
            console.error(`❌ Error in bulk create for ${tableName}:`, error);
            result.errors.push({ op: { type: 'CREATE', entity: tableName } as any, error: error.message });
          }
        }

        // Updates
        for (const upd of ops.updates) {
          try {
            // First check if entity exists
            const existing = await table.get(upd.id);
            if (existing) {
              // 🔴 FIX: For metres, merge hierarchical data to prevent data loss
              if (tableName === 'metres') {
                const mergedData = {
                  ...upd.data,
                  // Preserve local hierarchical data if server data is empty/undefined
                  sections: (upd.data.sections && upd.data.sections.length > 0) ? upd.data.sections : existing.sections,
                  subSections: (upd.data.subSections && upd.data.subSections.length > 0) ? upd.data.subSections : existing.subSections,
                  lignes: (upd.data.lignes && upd.data.lignes.length > 0) ? upd.data.lignes : existing.lignes,
                };
                await table.update(upd.id, mergedData);
                console.log(`📦 Merged metre update for ${upd.id} - preserved local hierarchical data`);
              } 
              // 🔴 FIX: For bordereaux, preserve local lignes with quantite values
              else if (tableName === 'bordereaux') {
                const localHasQuantite = existing.lignes?.some((l: any) => l.quantite > 0);
                const serverHasQuantite = upd.data.lignes?.some((l: any) => l.quantite > 0);
                
                const mergedData = {
                  ...upd.data,
                  lignes: (serverHasQuantite || !localHasQuantite) ? upd.data.lignes : existing.lignes,
                  montantTotal: (serverHasQuantite || !localHasQuantite) ? upd.data.montantTotal : existing.montantTotal,
                };
                await table.update(upd.id, mergedData);
                console.log(`📦 Merged bordereau update for ${upd.id} - preserved local lignes`);
              }
              else {
                await table.update(upd.id, upd.data);
              }
            } else {
              // If not exists, create it (server says update, but we don't have it)
              await table.put({ ...upd.data, id: upd.id });
            }
            result.applied++;
            addSyncLog({ action: 'UPDATE', entity: tableName, entityId: upd.id, success: true });
          } catch (error: any) {
            result.errors.push({ op: { type: 'UPDATE', entity: tableName, entityId: upd.id, data: upd.data } as any, error: error.message });
            addSyncLog({ action: 'UPDATE', entity: tableName, entityId: upd.id, success: false, error: error.message });
          }
        }

        // Bulk deletes
        if (ops.deletes.length > 0) {
          try {
            await table.bulkDelete(ops.deletes);
            result.applied += ops.deletes.length;
            addSyncLog({ action: 'BULK_DELETE', entity: tableName, success: true, data: { count: ops.deletes.length } });
          } catch (error: any) {
            // Fallback to individual deletes
            for (const id of ops.deletes) {
              try {
                await table.delete(id);
                result.applied++;
                addSyncLog({ action: 'DELETE', entity: tableName, entityId: id, success: true });
              } catch (delError: any) {
                result.errors.push({ op: { type: 'DELETE', entity: tableName, entityId: id } as any, error: delError.message });
                addSyncLog({ action: 'DELETE', entity: tableName, entityId: id, success: false, error: delError.message });
              }
            }
          }
        }
      }
    }
    );

  } catch (txError: any) {
    console.error('❌ Transaction error:', txError);
    addSyncLog({ action: 'TRANSACTION', success: false, error: txError.message });

    // Transaction failed, try individual operations
    for (const op of sortedOps) {
      try {
        const tableName = ENTITY_TO_TABLE[op.entity];
        if (!tableName) continue;

        const table = (db as any)[tableName];
        if (!table) continue;

        const entityId = normalizeEntityId(op.entity, op.entityId);
        const normalizedData = op.data ? { ...op.data } : {};

        if (normalizedData.projectId) {
          normalizedData.projectId = normalizeEntityId('project', normalizedData.projectId);
        }

        switch (op.type) {
          case 'CREATE':
          case 'UPDATE': {
            // 🔴 FIX: Apply same merge logic as in transaction for metres and bordereaux
            const existingLocal = await table.get(entityId);
            if (tableName === 'metres' && existingLocal) {
              const mergedData = {
                ...normalizedData,
                id: entityId,
                sections: (normalizedData.sections && normalizedData.sections.length > 0) ? normalizedData.sections : (existingLocal.sections || []),
                subSections: (normalizedData.subSections && normalizedData.subSections.length > 0) ? normalizedData.subSections : (existingLocal.subSections || []),
                lignes: (normalizedData.lignes && normalizedData.lignes.length > 0) ? normalizedData.lignes : (existingLocal.lignes || []),
              };
              await table.put(mergedData);
              console.log(`📦 Fallback: Merged metre data for ${entityId}`);
            } else if (tableName === 'bordereaux' && existingLocal) {
              const localHasQuantite = existingLocal.lignes?.some((l: any) => l.quantite > 0);
              const serverHasQuantite = normalizedData.lignes?.some((l: any) => l.quantite > 0);
              const mergedData = {
                ...normalizedData,
                id: entityId,
                lignes: (serverHasQuantite || !localHasQuantite) ? normalizedData.lignes : existingLocal.lignes,
                montantTotal: (serverHasQuantite || !localHasQuantite) ? normalizedData.montantTotal : existingLocal.montantTotal,
              };
              await table.put(mergedData);
              console.log(`📦 Fallback: Merged bordereau data for ${entityId}`);
            } else {
              await table.put({ ...normalizedData, id: entityId });
            }
            break;
          }
          case 'DELETE':
            await table.delete(entityId);
            break;
        }
        result.applied++;
        addSyncLog({ action: op.type, entity: op.entity, entityId, success: true });
      } catch (error: any) {
        result.errors.push({ op, error: error.message });
        addSyncLog({ action: op.type, entity: op.entity, entityId: op.entityId, success: false, error: error.message });
      }
    }
  }

  console.log(`📥 Applied: ${result.applied}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
  return result;
};

// ==================== DIRECT DATA FETCH ====================

/**
 * Fetch all data directly from API (for initial sync or recovery)
 * Will skip if there are unsaved changes (dirty pages)
 */
export const pullLatestData = async (projectId?: string, forcePull: boolean = false): Promise<number> => {
  // 🔴 التحقق من وجود تغييرات غير محفوظة
  const dirtyState = useDirtyStateStore.getState();
  if (dirtyState.hasAnyDirtyPages() && !forcePull) {
    const dirtyPages = dirtyState.getDirtyPages();
    console.log('⚠️ PULL SKIPPED: Unsaved changes detected in:', dirtyPages.map(p => p.pageName).join(', '));
    addSyncLog({ 
      action: 'PULL_SKIPPED', 
      success: true, 
      data: { reason: 'unsaved_changes', dirtyPages: dirtyPages.map(p => p.pageName) } 
    });
    return 0;
  }

  let totalPulled = 0;
  let totalDeleted = 0;

  console.log('📥 Starting direct data pull...', projectId ? `for project: ${projectId}` : 'all data');
  addSyncLog({ action: 'PULL_START', success: true, data: { projectId } });

  try {
    // Fetch projects from server
    const projectsResponse = await apiService.getProjects();
    const projects = projectsResponse.data || projectsResponse;

    if (Array.isArray(projects)) {
      // 🔴 PROFESSIONAL SYNC: Build set of server project IDs for comparison
      const serverProjectIds = new Set(
        projects.map(p => normalizeEntityId('project', p.id))
      );

      await db.transaction('rw', db.projects, async () => {
        // Step 1: Add/Update projects from server
        for (const project of projects) {
          if (projectId && cleanEntityId(project.id) !== cleanEntityId(projectId)) {
            continue;
          }

          const normalizedId = normalizeEntityId('project', project.id);
          await db.projects.put({
            ...project,
            id: normalizedId,
            userId: project.userId ? normalizeEntityId('user', project.userId) : project.userId,
          });
          totalPulled++;
        }

        // Step 2: Mark local projects not on server as deleted (Soft Delete Sync)
        // Only for full sync (no projectId filter)
        if (!projectId) {
          const localProjects = await db.projects.toArray();
          for (const localProject of localProjects) {
            if (!serverProjectIds.has(localProject.id) && !localProject.deletedAt) {
              // Project exists locally but not on server - mark as deleted
              console.log(`🗑️ Marking deleted project: ${localProject.id} (${localProject.objet})`);
              await db.projects.update(localProject.id, { 
                deletedAt: new Date().toISOString() 
              });
              totalDeleted++;
            }
          }
        }
      });

      if (totalDeleted > 0) {
        console.log(`🗑️ Soft-deleted ${totalDeleted} projects not found on server`);
      }

      // Fetch related data for each project
      const targetProjects = projectId
        ? projects.filter(p => cleanEntityId(p.id) === cleanEntityId(projectId))
        : projects;

      // 🔴 PROFESSIONAL SYNC: Track server IDs for each entity type per project
      const serverBordereauxIds = new Set<string>();
      const serverPeriodesIds = new Set<string>();
      const serverMetresIds = new Set<string>();
      const serverDecomptsIds = new Set<string>();

      for (const project of targetProjects) {
        const cleanProjId = cleanEntityId(project.id);
        const normalizedProjId = normalizeEntityId('project', cleanProjId);

        // Bordereaux
        try {
          const bordereauxResponse = await apiService.getBordereaux(cleanProjId);
          const bordereaux = bordereauxResponse.data || bordereauxResponse;

          if (Array.isArray(bordereaux) && bordereaux.length > 0) {
            await db.transaction('rw', db.bordereaux, async () => {
              for (const item of bordereaux) {
                const normalizedId = normalizeEntityId('bordereau', item.id);
                serverBordereauxIds.add(normalizedId);
                await db.bordereaux.put({
                  ...item,
                  id: normalizedId,
                  projectId: normalizedProjId,
                });
                totalPulled++;
              }
            });
          }
        } catch (e) { console.log('No bordereaux for project:', cleanProjId); }

        // Periodes
        try {
          const periodesResponse = await apiService.getPeriodes?.(cleanProjId);
          const periodes = periodesResponse?.data || periodesResponse;

          if (Array.isArray(periodes) && periodes.length > 0) {
            await db.transaction('rw', db.periodes, async () => {
              for (const item of periodes) {
                const normalizedId = normalizeEntityId('periode', item.id);
                serverPeriodesIds.add(normalizedId);
                await db.periodes.put({
                  ...item,
                  id: normalizedId,
                  projectId: normalizedProjId,
                });
                totalPulled++;
              }
            });
          }
        } catch (e) { console.log('No periodes for project:', cleanProjId); }

        // Metres
        try {
          const metresResponse = await apiService.getMetres(cleanProjId);
          const metres = metresResponse.data || metresResponse;

          if (Array.isArray(metres) && metres.length > 0) {
            await db.transaction('rw', db.metres, async () => {
              for (const item of metres) {
                const normalizedId = normalizeEntityId('metre', item.id);
                serverMetresIds.add(normalizedId);
                await db.metres.put({
                  ...item,
                  id: normalizedId,
                  projectId: normalizedProjId,
                  periodeId: item.periodeId ? normalizeEntityId('periode', item.periodeId) : '',
                });
                totalPulled++;
              }
            });
          }
        } catch (e) { console.log('No metres for project:', cleanProjId); }

        // Decompts
        try {
          const decomptsResponse = await apiService.getDecompts(cleanProjId);
          const decompts = decomptsResponse.data || decomptsResponse;

          if (Array.isArray(decompts) && decompts.length > 0) {
            await db.transaction('rw', db.decompts, async () => {
              for (const item of decompts) {
                const normalizedId = normalizeEntityId('decompt', item.id);
                serverDecomptsIds.add(normalizedId);
                await db.decompts.put({
                  ...item,
                  id: normalizedId,
                  projectId: normalizedProjId,
                  periodeId: item.periodeId ? normalizeEntityId('periode', item.periodeId) : '',
                });
                totalPulled++;
              }
            });
          }
        } catch (e) { console.log('No decompts for project:', cleanProjId); }
      }

      // 🔴 PROFESSIONAL SYNC: Soft-delete local entities not found on server
      // This handles the case where entities were deleted on the server but still exist locally
      let totalEntitiesDeleted = 0;

      // Soft-delete bordereaux not on server
      const localBordereaux = await db.bordereaux.filter(b => !b.deletedAt).toArray();
      for (const local of localBordereaux) {
        if (!serverBordereauxIds.has(local.id)) {
          await db.bordereaux.update(local.id, { deletedAt: new Date().toISOString() });
          totalEntitiesDeleted++;
        }
      }

      // Soft-delete periodes not on server
      const localPeriodes = await db.periodes.filter(p => !p.deletedAt).toArray();
      for (const local of localPeriodes) {
        if (!serverPeriodesIds.has(local.id)) {
          await db.periodes.update(local.id, { deletedAt: new Date().toISOString() });
          totalEntitiesDeleted++;
        }
      }

      // Soft-delete metres not on server
      const localMetres = await db.metres.filter(m => !m.deletedAt).toArray();
      for (const local of localMetres) {
        if (!serverMetresIds.has(local.id)) {
          await db.metres.update(local.id, { deletedAt: new Date().toISOString() });
          totalEntitiesDeleted++;
        }
      }

      // Soft-delete decompts not on server
      const localDecompts = await db.decompts.filter(d => !d.deletedAt).toArray();
      for (const local of localDecompts) {
        if (!serverDecomptsIds.has(local.id)) {
          await db.decompts.update(local.id, { deletedAt: new Date().toISOString() });
          totalEntitiesDeleted++;
        }
      }

      if (totalEntitiesDeleted > 0) {
        console.log(`🗑️ Soft-deleted ${totalEntitiesDeleted} entities (bordereaux/periodes/metres/decompts) not found on server`);
      }
    }

    addSyncLog({ action: 'PULL_COMPLETE', success: true, data: { totalPulled } });
    console.log(`📥 Direct pull complete: ${totalPulled} items`);

  } catch (error: any) {
    console.error('❌ Direct pull error:', error);
    addSyncLog({ action: 'PULL_ERROR', success: false, error: error.message });
    throw error;
  }

  return totalPulled;
};

// ==================== MAIN HOOK ====================

export const useSyncManager = (userId: string | null) => {
  // ==================== PENDING COUNT (REACTIVE) ====================
  const pendingCount = useLiveQuery(async () => {
    if (!userId) return 0;
    return await db.syncOperations.where('synced').equals(0).count();
  }, [userId]) || 0;

  const [syncState, setSyncState] = useState<SyncState>({
    status: isOnline() ? 'idle' : 'offline',
    lastSyncTime: getLastSyncTimestamp() || null,
    pendingOperations: 0,
    error: null,
    lastPullCount: 0,
    realtimeConnected: false,
  });

  // Sync state update effect
  useEffect(() => {
    setSyncState(prev => ({ ...prev, pendingOperations: pendingCount }));
  }, [pendingCount]);

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const syncInProgressRef = useRef(false);
  const realtimeSetupRef = useRef(false);

  // ==================== REALTIME CONNECTION ====================

  const connectRealtime = useCallback(() => {
    if (!userId) return;

    // Allow reconnection if not already connected
    if (realtimeSetupRef.current && realtimeSync.isConnected()) return;

    const token = localStorage.getItem('authToken');
    if (!token) return;

    const deviceId = getDeviceId();

    // Get server URL
    let serverUrl = 'http://localhost:3000';
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      serverUrl = window.location.origin;
    }
    // Electron uses production server
    if (window.navigator.userAgent.includes('Electron') || (window as any).electronAPI) {
      serverUrl = 'https://marocinfra.com';
    }

    console.log('🔌 Connecting to realtime server:', serverUrl);
    realtimeSync.connect(serverUrl, token, deviceId, userId);
    realtimeSetupRef.current = true;

    // Listen for status changes
    const unsubStatus = realtimeSync.onStatusChange((status) => {
      setSyncState(prev => ({
        ...prev,
        realtimeConnected: status === 'connected',
        status: status === 'connected' ? 'realtime' : prev.status,
      }));
    });

    // Listen for operations
    const unsubOp = realtimeSync.onOperation((op: RealtimeOperation) => {
      console.log('🔄 Realtime op in sync manager:', op.type, op.entity);

      // Emit event for UI components
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
        });
      }
      realtimeEvents.emit(REALTIME_EVENTS.DATA_CHANGED, {
        entity: op.entity,
        type: op.type,
        entityId: op.entityId,
        data: op.data,
      });
    });

    return () => {
      unsubStatus();
      unsubOp();
    };
  }, [userId]);

  // ==================== PENDING COUNT ====================

  const updatePendingCount = useCallback(async () => {
    if (!userId) return;

    try {
      const pending = await db.syncOperations
        .where('synced')
        .equals(0)
        .count();
      setSyncState((prev) => ({ ...prev, pendingOperations: pending }));
    } catch (error) {
      console.error('Error updating pending count:', error);
    }
  }, [userId]);

  // ==================== SYNC PUSH ====================

  const syncPush = useCallback(async (): Promise<void> => {
    if (!userId || !isOnline()) {
      console.log('🚫 Cannot push: user not authenticated or offline');
      return;
    }

    console.log('📤 [v3] Starting sync push...');
    addSyncLog({ action: 'PUSH_START', success: true });

    try {
      // Get pending operations
      const pendingOps = await db.syncOperations
        .filter(op => !op.synced && op.userId === userId)
        .toArray();

      if (pendingOps.length === 0) {
        console.log('📤 No pending operations');
        return;
      }

      console.log(`📤 Found ${pendingOps.length} pending operations`);

      // Transform for API
      const transformedOps = pendingOps.map(op => ({
        id: op.id,
        type: op.type,
        entity: op.entity,
        entityId: cleanEntityId(op.entityId),
        data: op.data,
        timestamp: op.timestamp,
      }));

      // Send to server
      const result = await apiService.syncPush(transformedOps, getDeviceId());
      console.log('📤 Server response:', result);

      // Mark successful operations as synced
      const ackOps = result.data?.success || result.success || [];
      if (Array.isArray(ackOps) && ackOps.length > 0) {
        const ackedIds = pendingOps
          .filter(op => ackOps.includes(op.id) || ackOps.includes(cleanEntityId(op.entityId)))
          .map(op => op.id);

        if (ackedIds.length > 0) {
          // Update each record individually (Dexie doesn't have bulkUpdate)
          await db.transaction('rw', db.syncOperations, async () => {
            for (const id of ackedIds) {
              await db.syncOperations.update(id, { synced: true, syncedAt: new Date().toISOString() });
            }
          });
        }
      }

      // Handle errors - Mark permanently failed ops to prevent infinite retry
      const errors = result.data?.failed || result.failed || [];
      if (errors.length > 0) {
        console.error('❌ Some operations failed:', errors);
        addSyncLog({ action: 'PUSH_ERRORS', success: false, data: { errors } });
        
        // CRITICAL: Mark operations with permanent errors as "failed" to stop retrying
        // Errors like "numeric field overflow" will never succeed, so stop trying
        // But DO NOT delete foreign key errors - they may succeed when parent is created
        const fatalErrorPatterns = ['overflow', 'invalid input', 'duplicate key', 'not-null'];
        // Exclude foreign key errors - they are recoverable if parent gets created
        const recoverablePatterns = ['foreign key', 'fkey'];
        
        for (const errItem of errors) {
          const errorMsg = (errItem.error || '').toLowerCase();
          const isRecoverable = recoverablePatterns.some(pattern => errorMsg.includes(pattern));
          const isFatalError = fatalErrorPatterns.some(pattern => errorMsg.includes(pattern));
          
          if (isFatalError && !isRecoverable) {
            // Find the matching pending op and mark it as failed (synced=true with error flag)
            const failedOp = pendingOps.find(op => 
              op.id === errItem.id || 
              cleanEntityId(op.entityId) === errItem.id ||
              op.entityId.includes(errItem.id)
            );
            
            if (failedOp && failedOp.id) {
              console.warn(`🗑️ Marking permanently failed op for deletion: ${failedOp.entity}:${failedOp.entityId}`);
              // Delete the failed operation to prevent infinite retries
              await db.syncOperations.delete(failedOp.id);
              addSyncLog({ 
                action: 'DELETE_FAILED_OP', 
                entity: failedOp.entity, 
                entityId: failedOp.entityId, 
                success: true, 
                error: errItem.error 
              });
            }
          } else if (isRecoverable) {
            console.log(`⏳ Recoverable error, keeping op for retry: ${errItem.error?.slice(0, 50)}...`);
          }
        }
      }

      addSyncLog({ action: 'PUSH_COMPLETE', success: true, data: { pushed: ackOps.length } });

    } catch (error: any) {
      console.error('❌ Push error:', error);
      addSyncLog({ action: 'PUSH_ERROR', success: false, error: error.message });
      throw error;
    }
  }, [userId]);

  // ==================== SYNC PULL ====================

  const syncPull = useCallback(async (): Promise<void> => {
    if (!userId || !isOnline()) {
      console.log('🚫 Cannot pull: user not authenticated or offline');
      return;
    }

    console.log('📥 [v3] Starting sync pull...');
    setSyncState(prev => ({ ...prev, status: 'pulling' }));
    addSyncLog({ action: 'PULL_START', success: true });

    try {
      const lastSync = getLastSyncTimestamp();

      // Request changes from server
      const result = await apiService.syncPull(lastSync, getDeviceId());
      console.log('📥 Pull response received');

      const operations = result.data?.operations || result.operations || [];
      const serverTime = result.data?.serverTime || result.serverTime || Date.now();

      if (operations.length === 0 && lastSync === 0) {
        // Initial sync - fetch all data directly
        console.log('📥 No sync operations, performing direct fetch...');
        const pulled = await pullLatestData();
        setSyncState(prev => ({ ...prev, lastPullCount: pulled }));
      } else if (operations.length > 0) {
        // Apply received operations
        const applyResult = await applyRemoteOperations(operations);
        setSyncState(prev => ({ ...prev, lastPullCount: applyResult.applied }));

        if (applyResult.errors.length > 0) {
          // Log errors to server (optional)
          console.error('❌ Some operations failed to apply:', applyResult.errors);
        }
      }

      // Update last sync timestamp
      setLastSyncTimestamp(serverTime);
      
      // 🔴 Mark full sync complete to prevent realtime sync:state from re-applying
      realtimeSync.markFullSyncComplete();

      addSyncLog({ action: 'PULL_COMPLETE', success: true });

    } catch (error: any) {
      console.error('❌ Pull error:', error);
      addSyncLog({ action: 'PULL_ERROR', success: false, error: error.message });

      // Don't throw for 401 - will be handled by auth interceptor
      if (error.response?.status !== 401) {
        throw error;
      }
    }
  }, [userId]);

  // ==================== FULL SYNC ====================

  const sync = useCallback(async (): Promise<void> => {
    if (syncInProgressRef.current) {
      console.log('🚫 Sync already in progress');
      return;
    }

    if (!userId || !isOnline()) {
      setSyncState(prev => ({
        ...prev,
        status: 'offline',
        error: 'Cannot sync while offline',
      }));
      return;
    }

    syncInProgressRef.current = true;
    setSyncState(prev => ({ ...prev, status: 'syncing', error: null }));

    try {
      // 1. Push local changes
      await syncPush();

      // 2. Pull remote changes
      await syncPull();



      // 4. Clean old operations
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      await db.syncOperations
        .where('syncedAt')
        .below(thirtyDaysAgo.toISOString())
        .delete();

      setSyncState(prev => ({
        ...prev,
        status: 'synced',
        lastSyncTime: Date.now(),
        error: null,
      }));

      addSyncLog({ action: 'SYNC_COMPLETE', success: true });

    } catch (error: any) {
      setSyncState(prev => ({
        ...prev,
        status: 'error',
        error: error.message || 'Sync failed',
      }));
      addSyncLog({ action: 'SYNC_ERROR', success: false, error: error.message });
    } finally {
      syncInProgressRef.current = false;
    }
  }, [userId, syncPush, syncPull, updatePendingCount]);

  // ==================== EFFECTS ====================

  // Handle online/offline
  useEffect(() => {
    const handleOnline = () => {
      setSyncState(prev => ({ ...prev, status: 'idle' }));
      if (autoSyncEnabled) {
        setTimeout(() => sync(), 1000);
      }
    };

    const handleOffline = () => {
      setSyncState(prev => ({ ...prev, status: 'offline' }));
    };

    const cleanup = setupOnlineListener(handleOnline, handleOffline);
    return cleanup;
  }, [sync, autoSyncEnabled]);

  // Adaptive sync interval: faster when WebSocket disconnected, slower when connected
  useEffect(() => {
    if (!autoSyncEnabled || !isOnline()) return;

    // Shorter interval when WebSocket is not connected (10 seconds)
    // Longer interval when connected (2 minutes) as backup
    const getInterval = () => {
      return syncState.realtimeConnected ? 2 * 60 * 1000 : 10 * 1000;
    };

    let intervalId: ReturnType<typeof setInterval>;
    
    const startInterval = () => {
      clearInterval(intervalId);
      intervalId = setInterval(() => {
        sync().catch(console.error);
      }, getInterval());
    };

    startInterval();

    // Re-evaluate interval when realtime status changes
    return () => clearInterval(intervalId);
  }, [sync, autoSyncEnabled, syncState.realtimeConnected]);

  // Update pending count on mount
  useEffect(() => {
    updatePendingCount();
  }, [updatePendingCount]);

  // Connect to realtime when user is available
  useEffect(() => {
    if (userId && isOnline()) {
      const cleanup = connectRealtime();
      return () => {
        if (cleanup) cleanup();
        realtimeSetupRef.current = false;
      };
    }
  }, [userId, connectRealtime]);

  // Reconnect realtime when coming online
  useEffect(() => {
    const handleOnline = () => {
      if (userId && !realtimeSync.isConnected()) {
        console.log('🌐 Back online, reconnecting realtime...');
        connectRealtime();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [userId, connectRealtime]);

  // Periodic WebSocket health check - try to reconnect every 30 seconds if disconnected
  useEffect(() => {
    if (!userId || !isOnline()) return;

    const healthCheck = setInterval(() => {
      if (!realtimeSync.isConnected()) {
        console.log('🔄 WebSocket health check: Not connected, attempting reconnect...');
        connectRealtime();
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(healthCheck);
  }, [userId, connectRealtime]);

  // ==================== CLEAR PENDING OPERATIONS ====================

  /**
   * Clear all pending (failed) sync operations from local database
   * Use this when sync is stuck due to invalid operations
   */
  const clearPendingOperations = useCallback(async () => {
    try {
      // Get pending operations
      const pending = await db.syncOperations
        .filter(op => op.synced === false || op.synced === undefined)
        .toArray();

      if (pending.length === 0) {
        console.log('📭 No pending operations to clear');
        return { cleared: 0 };
      }

      console.log(`🗑️ Clearing ${pending.length} pending operations...`);

      // Delete all pending operations
      const ids = pending.map(op => op.id).filter((id): id is string => id !== undefined && id !== null);
      await db.syncOperations.bulkDelete(ids);

      // Update state
      setSyncState(prev => ({
        ...prev,
        pendingOperations: 0,
        error: null,
        status: 'idle',
      }));

      console.log(`✅ Cleared ${pending.length} pending operations`);
      return { cleared: pending.length };
    } catch (error: any) {
      console.error('❌ Failed to clear pending operations:', error);
      return { cleared: 0, error: error.message };
    }
  }, []);

  /**
   * Repair orphaned entities - create sync operations for entities that exist locally but weren't synced
   */
  const repairOrphanedEntities = useCallback(async () => {
    if (!userId) return { repaired: 0, errors: [] as string[] };
    
    console.log('🔧 Starting orphaned entity repair...');
    const deviceId = getDeviceId();
    const now = Date.now();
    let repaired = 0;
    const errors: string[] = [];
    
    try {
      // Get all local projects
      const localProjects = await db.projects.where('userId').equals(userId).toArray();
      
      for (const project of localProjects) {
        // Check if there's a pending CREATE sync operation for this project
        const existingOp = await db.syncOperations
          .where('entityId')
          .equals(project.id)
          .filter(op => op.type === 'CREATE' && !op.synced)
          .first();
        
        if (!existingOp) {
          // No CREATE op exists - create one
          console.log(`🔧 Creating missing sync op for project: ${project.id}`);
          
          const syncOp = {
            id: `repair:${project.id}:${now}`,
            userId,
            deviceId,
            type: 'CREATE' as const,
            entity: 'project' as const,
            entityId: project.id,
            data: project,
            timestamp: now - 1000, // Slightly in the past to ensure it's processed first
            synced: false,
          };
          
          await db.syncOperations.add(syncOp);
          repaired++;
          console.log(`✅ Created repair sync op for project: ${project.marcheNo}`);
        }
      }
      
      // Also check bordereaux, periodes, metres, decompts
      type EntityConfig = {
        table: typeof db.bordereaux | typeof db.periodes | typeof db.metres | typeof db.decompts;
        entity: 'bordereau' | 'periode' | 'metre' | 'decompt';
      };
      
      const entityConfigs: EntityConfig[] = [
        { table: db.bordereaux, entity: 'bordereau' },
        { table: db.periodes, entity: 'periode' },
        { table: db.metres, entity: 'metre' },
        { table: db.decompts, entity: 'decompt' },
      ];
      
      for (const config of entityConfigs) {
        const localEntities = await config.table.where('userId').equals(userId).toArray();
        
        for (const entity of localEntities) {
          const existingOp = await db.syncOperations
            .where('entityId')
            .equals(entity.id)
            .filter(op => op.type === 'CREATE' && !op.synced)
            .first();
          
          if (!existingOp) {
            const syncOp = {
              id: `repair:${entity.id}:${now}`,
              userId,
              deviceId,
              type: 'CREATE' as const,
              entity: config.entity,
              entityId: entity.id,
              data: entity,
              timestamp: now,
              synced: false,
            };
            
            await db.syncOperations.add(syncOp);
            repaired++;
          }
        }
      }
      
      console.log(`✅ Repaired ${repaired} orphaned entities`);
      
      // Trigger sync to push the repaired operations
      if (repaired > 0) {
        await updatePendingCount();
      }
      
      return { repaired, errors };
    } catch (error: any) {
      console.error('❌ Repair failed:', error);
      errors.push(error.message);
      return { repaired, errors };
    }
  }, [userId, updatePendingCount]);

  /**
   * Full reset: Clear all local data and re-sync from server
   */
  const resetAndResync = useCallback(async () => {
    if (!userId) return;

    try {
      console.log('🔄 Starting full reset and resync...');

      // 1. Clear pending operations
      await clearPendingOperations();

      // 2. Reset sync timestamp
      setLastSyncTimestamp(0);

      // 3. Pull fresh data from server
      await pullLatestData();

      console.log('✅ Reset and resync completed');
    } catch (error: any) {
      console.error('❌ Reset and resync failed:', error);
    }
  }, [userId, clearPendingOperations, pullLatestData]);

  // ==================== REFRESH FROM SERVER ====================
  /**
   * Force refresh data from server - THE SERVER IS THE SOURCE OF TRUTH
   * This should be called when opening any page to ensure data consistency
   */
  const refreshFromServer = useCallback(async (projectId?: string): Promise<void> => {
    if (!userId || !isOnline()) {
      console.log('🚫 Cannot refresh: user not authenticated or offline');
      return;
    }

    console.log('🔄 [SERVER_REFRESH] Forcing data refresh from server...');
    setSyncState(prev => ({ ...prev, status: 'pulling' }));

    try {
      // 1. First push any pending local changes
      await syncPush();
      
      // 2. Then pull latest data from server (force pull ignores dirty state)
      const pulled = await pullLatestData(projectId, true);
      
      console.log(`✅ [SERVER_REFRESH] Refreshed ${pulled} items from server`);
      setSyncState(prev => ({ ...prev, status: 'synced', lastPullCount: pulled }));
    } catch (error: any) {
      console.error('❌ [SERVER_REFRESH] Failed:', error);
      setSyncState(prev => ({ ...prev, status: 'error', error: error.message }));
    }
  }, [userId, syncPush]);

  return {
    syncState,
    sync,
    syncPush,
    syncPull,
    pullLatestData,
    refreshFromServer,
    updatePendingCount,
    autoSyncEnabled,
    setAutoSyncEnabled,
    isOnline: isOnline(),
    isRealtimeConnected: syncState.realtimeConnected,
    // Realtime controls
    connectRealtime,
    disconnectRealtime: () => realtimeSync.disconnect(),
    subscribeToProject: (projectId: string) => realtimeSync.subscribeToProject(projectId),
    unsubscribeFromProject: (projectId: string) => realtimeSync.unsubscribeFromProject(projectId),
    // Recovery tools
    clearPendingOperations,
    resetAndResync,
    repairOrphanedEntities,
    // Debug tools
    getSyncLogs,
    clearSyncLogs,
    inspectSync: () => userId ? inspectSync(userId) : Promise.resolve({
      localCounts: {},
      missingEntities: [],
      orphanedEntities: [],
      errors: ['No user ID'],
    }),
  };
};
