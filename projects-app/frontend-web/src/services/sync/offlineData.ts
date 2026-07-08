/**
 * Offline Data Manager
 * 
 * Wraps data operations to support offline-first approach.
 * Automatically queues operations when offline.
 */

import { db } from '../../db/database';
import { addPendingOperation } from './pendingOpsStore';
import { isElectron } from './types';

// ============================================
// Generic Offline Operations
// ============================================

interface OfflineOptions {
  /** Skip queueing (for read-only operations) */
  skipQueue?: boolean;
  /** User ID for the operation */
  userId?: string;
}

/**
 * Create an entity with offline support
 */
export async function offlineCreate<T extends { id: string }>(
  entity: string,
  data: T,
  options: OfflineOptions = {}
): Promise<T> {
  const table = getTable(entity);
  
  // Save locally first
  await table.put(data);
  
  // Queue for sync if in Electron
  if (isElectron() && !options.skipQueue) {
    await addPendingOperation('CREATE', entity as any, data.id, {
      ...data,
      userId: options.userId,
    });
  }
  
  console.log(`[OfflineData] Created ${entity}:${data.id}`);
  return data;
}

/**
 * Update an entity with offline support
 */
export async function offlineUpdate<T extends { id: string }>(
  entity: string,
  id: string,
  updates: Partial<T>,
  options: OfflineOptions = {}
): Promise<T> {
  const table = getTable(entity);
  
  // Get current data
  const existing = await table.get(id);
  if (!existing) {
    throw new Error(`${entity} with id ${id} not found`);
  }
  
  // Merge updates
  const updated = { 
    ...existing, 
    ...updates, 
    updatedAt: new Date().toISOString(),
  };
  
  // Save locally
  await table.put(updated);
  
  // Queue for sync if in Electron
  if (isElectron() && !options.skipQueue) {
    await addPendingOperation('UPDATE', entity as any, id, {
      ...updated,
      userId: options.userId,
    });
  }
  
  console.log(`[OfflineData] Updated ${entity}:${id}`);
  return updated as T;
}

/**
 * Delete an entity with offline support (soft delete)
 */
export async function offlineDelete(
  entity: string,
  id: string,
  options: OfflineOptions = {}
): Promise<void> {
  const table = getTable(entity);
  
  // Soft delete - mark as deleted
  const existing = await table.get(id);
  if (existing) {
    await table.update(id, { 
      deletedAt: new Date().toISOString(),
    });
  }
  
  // Queue for sync if in Electron
  if (isElectron() && !options.skipQueue) {
    await addPendingOperation('DELETE', entity as any, id, {
      id,
      userId: options.userId,
    });
  }
  
  console.log(`[OfflineData] Deleted ${entity}:${id}`);
}

/**
 * Get an entity by ID
 */
export async function offlineGet<T>(
  entity: string,
  id: string
): Promise<T | undefined> {
  const table = getTable(entity);
  const item = await table.get(id);
  
  // Filter out soft-deleted items
  if (item && (item as any).deletedAt) {
    return undefined;
  }
  
  return item as T;
}

/**
 * Get all entities
 */
export async function offlineGetAll<T>(
  entity: string,
  filter?: (item: T) => boolean
): Promise<T[]> {
  const table = getTable(entity);
  let items = await table.toArray();
  
  // Filter out soft-deleted items
  items = items.filter((item: any) => !item.deletedAt);
  
  // Apply custom filter
  if (filter) {
    items = items.filter(filter as any);
  }
  
  return items as T[];
}

/**
 * Get entities by index
 */
export async function offlineGetByIndex<T>(
  entity: string,
  indexName: string,
  value: any
): Promise<T[]> {
  const table = getTable(entity);
  const items = await table.where(indexName).equals(value).toArray();
  
  // Filter out soft-deleted items
  return items.filter((item: any) => !item.deletedAt) as T[];
}

// ============================================
// Helper Functions
// ============================================

function getTable(entity: string) {
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
    user: db.users,
  };
  
  const table = tables[entity];
  if (!table) {
    throw new Error(`Unknown entity: ${entity}`);
  }
  
  return table;
}

// ============================================
// Entity-Specific Functions
// ============================================

/**
 * Project operations
 */
export const offlineProjects = {
  create: (data: any, userId?: string) => 
    offlineCreate('project', data, { userId }),
  
  update: (id: string, updates: any, userId?: string) => 
    offlineUpdate('project', id, updates, { userId }),
  
  delete: (id: string, userId?: string) => 
    offlineDelete('project', id, { userId }),
  
  get: (id: string) => 
    offlineGet('project', id),
  
  getAll: (userId?: string) => 
    offlineGetAll('project', userId ? (p: any) => p.userId === userId : undefined),
  
  getByUser: (userId: string) => 
    offlineGetByIndex('project', 'userId', userId),
};

/**
 * Bordereau operations
 */
export const offlineBordereaux = {
  create: (data: any, userId?: string) => 
    offlineCreate('bordereau', data, { userId }),
  
  update: (id: string, updates: any, userId?: string) => 
    offlineUpdate('bordereau', id, updates, { userId }),
  
  delete: (id: string, userId?: string) => 
    offlineDelete('bordereau', id, { userId }),
  
  get: (id: string) => 
    offlineGet('bordereau', id),
  
  getByProject: (projectId: string) => 
    offlineGetByIndex('bordereau', 'projectId', projectId),
};

/**
 * Periode operations
 */
export const offlinePeriodes = {
  create: (data: any, userId?: string) => 
    offlineCreate('periode', data, { userId }),
  
  update: (id: string, updates: any, userId?: string) => 
    offlineUpdate('periode', id, updates, { userId }),
  
  delete: (id: string, userId?: string) => 
    offlineDelete('periode', id, { userId }),
  
  get: (id: string) => 
    offlineGet('periode', id),
  
  getByProject: (projectId: string) => 
    offlineGetByIndex('periode', 'projectId', projectId),
};

/**
 * Metre operations
 */
export const offlineMetres = {
  create: (data: any, userId?: string) => 
    offlineCreate('metre', data, { userId }),
  
  update: (id: string, updates: any, userId?: string) => 
    offlineUpdate('metre', id, updates, { userId }),
  
  delete: (id: string, userId?: string) => 
    offlineDelete('metre', id, { userId }),
  
  get: (id: string) => 
    offlineGet('metre', id),
  
  getByProject: (projectId: string) => 
    offlineGetByIndex('metre', 'projectId', projectId),
  
  getByPeriode: (periodeId: string) => 
    offlineGetByIndex('metre', 'periodeId', periodeId),
};

/**
 * Decompt operations
 */
export const offlineDecompts = {
  create: (data: any, userId?: string) => 
    offlineCreate('decompt', data, { userId }),
  
  update: (id: string, updates: any, userId?: string) => 
    offlineUpdate('decompt', id, updates, { userId }),
  
  delete: (id: string, userId?: string) => 
    offlineDelete('decompt', id, { userId }),
  
  get: (id: string) => 
    offlineGet('decompt', id),
  
  getByProject: (projectId: string) => 
    offlineGetByIndex('decompt', 'projectId', projectId),
  
  getByPeriode: (periodeId: string) => 
    offlineGetByIndex('decompt', 'periodeId', periodeId),
};
