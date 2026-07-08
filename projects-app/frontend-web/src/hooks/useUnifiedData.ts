/**
 * useUnifiedData - Unified Data Hooks
 * 
 * يختار تلقائيًا بين:
 * 🌐 Web: useWebData (Server-First، لا IndexedDB)
 * 🖥️ Electron: useElectronData (Offline-First، IndexedDB + Dexie)
 * 
 * الصفحات تستخدم هذه الـ hooks فقط ولا تهتم بالمنصة
 */

import { isWeb, isElectron } from '../utils/platform';

// Web hooks (Server-First)
import {
  useWebProjects,
  useWebProject,
  useWebBordereaux,
  useWebPeriodes,
  useWebMetres,
  useWebDecompts,
  useWebProjectData,
  useWebPhotos,
  useWebPvs,
  useWebAttachments,
  useWebAggregatedMetres,
  useOnlineStatus,
} from './useWebData';

// Re-export types
export type { Project, Bordereau, Periode, Metre, Decompt, Photo, PV, Attachment, AggregatedMetre } from './useWebData';

// ==================== ELECTRON HOOKS (will use Dexie) ====================
// These are wrappers that use the existing Dexie-based hooks for Electron

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/apiService';

/**
 * Electron: Projects from IndexedDB with server sync
 */
const useElectronProjects = (userId: string | null) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const syncedRef = useRef(false);

  // Live query from IndexedDB
  const projects = useLiveQuery(
    async () => {
      if (!userId) return [];
      const userIdVariants = [
        userId,
        userId.includes(':') ? userId.split(':').pop()! : userId,
        userId.includes(':') ? userId : `user:${userId}`,
      ];
      const allProjects = await db.projects.filter(p => !p.deletedAt).toArray();
      return allProjects.filter(p => userIdVariants.includes(p.userId));
    },
    [userId]
  );

  // Sync with server when online
  const syncWithServer = useCallback(async () => {
    if (!userId || !navigator.onLine) return;
    
    try {
      const response = await apiService.getProjects();
      const serverProjects = (response.data || response) as any[];
      
      // Create a Set of server project IDs for efficient lookup
      const serverProjectIds = new Set(
        serverProjects.map(p => p.id.includes(':') ? p.id : `project:${p.id}`)
      );
      
      // Update local DB
      await db.transaction('rw', db.projects, async () => {
        // Add/Update projects from server
        for (const project of serverProjects) {
          const id = project.id.includes(':') ? project.id : `project:${project.id}`;
          await db.projects.put({ ...project, id });
        }
        
        // 🔴 PROFESSIONAL SYNC: Soft-delete local projects not found on server
        const localProjects = await db.projects.filter(p => !p.deletedAt).toArray();
        for (const local of localProjects) {
          if (!serverProjectIds.has(local.id)) {
            console.log(`🗑️ Soft-deleting project not on server: ${local.id}`);
            await db.projects.update(local.id, { deletedAt: new Date().toISOString() });
          }
        }
      });
    } catch (err) {
      console.error('[ELECTRON] Sync failed:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && !syncedRef.current && navigator.onLine) {
      syncedRef.current = true;
      syncWithServer().finally(() => setIsLoading(false));
    } else if (projects !== undefined) {
      setIsLoading(false);
    }
  }, [userId, projects, syncWithServer]);

  return {
    projects: projects || [],
    isLoading,
    error,
    refresh: syncWithServer,
    silentRefresh: syncWithServer,
  };
};

/**
 * Electron: Single project from IndexedDB
 */
const useElectronProject = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const project = useLiveQuery(
    () => normalizedId ? db.projects.get(normalizedId) : undefined,
    [normalizedId]
  );

  return {
    project: project || null,
    isLoading: project === undefined,
    error: null,
    refresh: async () => {},
  };
};

/**
 * Electron: Bordereaux from IndexedDB
 */
const useElectronBordereaux = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const bordereaux = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.bordereaux
        .where('projectId')
        .equals(normalizedId)
        .filter(b => !b.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    bordereaux: bordereaux || [],
    bordereau: bordereaux?.[0] || null,
    isLoading: bordereaux === undefined,
    error: null,
    refresh: async () => {},
  };
};

/**
 * Electron: Périodes from IndexedDB
 */
const useElectronPeriodes = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const periodes = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.periodes
        .where('projectId')
        .equals(normalizedId)
        .filter(p => !p.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    periodes: (periodes || []).sort((a, b) => a.numero - b.numero),
    isLoading: periodes === undefined,
    error: null,
    refresh: async () => {},
  };
};

/**
 * Electron: Métrés from IndexedDB
 */
const useElectronMetres = (projectId: string | null, periodeId?: string | null) => {
  const normalizedProjectId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  const normalizedPeriodeId = periodeId ? (periodeId.includes(':') ? periodeId : `periode:${periodeId}`) : null;
  
  const metres = useLiveQuery(
    async () => {
      if (!normalizedProjectId) return [];
      let query = db.metres
        .where('projectId')
        .equals(normalizedProjectId)
        .filter(m => !m.deletedAt);
      
      const results = await query.toArray();
      
      if (normalizedPeriodeId) {
        return results.filter(m => m.periodeId === normalizedPeriodeId);
      }
      return results;
    },
    [normalizedProjectId, normalizedPeriodeId]
  );

  return {
    metres: metres || [],
    isLoading: metres === undefined,
    error: null,
    refresh: async () => {},
  };
};

/**
 * Electron: Décomptes from IndexedDB
 */
const useElectronDecompts = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const decompts = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.decompts
        .where('projectId')
        .equals(normalizedId)
        .filter(d => !d.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    decompts: decompts || [],
    isLoading: decompts === undefined,
    error: null,
    refresh: async () => {},
  };
};

/**
 * Electron: Photos from IndexedDB
 */
const useElectronPhotos = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const photos = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.photos
        .where('projectId')
        .equals(normalizedId)
        .filter(p => !p.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    photos: photos || [],
    isLoading: photos === undefined,
    refresh: async () => {},
  };
};

/**
 * Electron: PVs from IndexedDB
 */
const useElectronPvs = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const pvs = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.pvs
        .where('projectId')
        .equals(normalizedId)
        .filter(p => !p.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    pvs: pvs || [],
    isLoading: pvs === undefined,
    refresh: async () => {},
  };
};

/**
 * Electron: Attachments from IndexedDB
 */
const useElectronAttachments = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const attachments = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      return db.attachments
        .where('projectId')
        .equals(normalizedId)
        .filter(a => !a.deletedAt)
        .toArray();
    },
    [normalizedId]
  );

  return {
    attachments: attachments || [],
    isLoading: attachments === undefined,
    refresh: async () => {},
  };
};

/**
 * Electron: Aggregated métrés from IndexedDB
 */
const useElectronAggregatedMetres = (projectId: string | null) => {
  const normalizedId = projectId?.includes(':') ? projectId : `project:${projectId}`;
  
  const aggregatedMetres = useLiveQuery(
    async () => {
      if (!normalizedId) return [];
      
      // Get all metres for this project
      const allMetres = await db.metres
        .where('projectId')
        .equals(normalizedId)
        .filter(m => !m.deletedAt)
        .toArray();
      
      if (allMetres.length === 0) return [];

      // Get all périodes
      const allPeriodes = await db.periodes
        .where('projectId')
        .equals(normalizedId)
        .filter(p => !p.deletedAt)
        .toArray();

      // Sort périodes by numero descending to find the latest
      const sortedPeriodes = allPeriodes.sort((a, b) => b.numero - a.numero);
      const latestPeriodeId = sortedPeriodes.length > 0 ? sortedPeriodes[0].id : null;

      // Helper to normalize bordereauLigneId
      const normalizeBordereauLigneId = (id: string): string => {
        if (id.includes('_')) {
          const parts = id.split('_');
          return parts[parts.length - 1];
        }
        return id;
      };

      // Group metres by normalized bordereauLigneId
      const groupedMap = new Map<string, {
        reference: string;
        designationBordereau: string;
        unite: string;
        quantiteBordereau: number;
        totalCumule: number;
        totalPartiel: number;
      }>();

      for (const metre of allMetres) {
        const normalizedBLId = normalizeBordereauLigneId(metre.bordereauLigneId);
        
        const existing = groupedMap.get(normalizedBLId);
        if (existing) {
          existing.totalCumule += metre.totalPartiel || 0;
          if (metre.periodeId === latestPeriodeId) {
            existing.totalPartiel = metre.totalPartiel || 0;
          }
        } else {
          groupedMap.set(normalizedBLId, {
            reference: metre.reference,
            designationBordereau: metre.designationBordereau,
            unite: metre.unite,
            quantiteBordereau: metre.quantiteBordereau,
            totalCumule: metre.totalPartiel || 0,
            totalPartiel: metre.periodeId === latestPeriodeId ? (metre.totalPartiel || 0) : 0,
          });
        }
      }

      // Convert to array and calculate pourcentageRealisation
      const result = Array.from(groupedMap.entries()).map(([normalizedBLId, data]) => {
        const qtyBordereau = Number(data.quantiteBordereau) || 0;
        const totalCumule = Number(data.totalCumule) || 0;
        const pourcentage = qtyBordereau > 0 ? (totalCumule / qtyBordereau) * 100 : 0;
        const refParts = data.reference.split('-');
        const cleanRef = refParts.length > 0 ? refParts[refParts.length - 1] : data.reference;
        return {
          id: normalizedBLId,
          reference: cleanRef,
          designationBordereau: data.designationBordereau,
          unite: data.unite,
          quantiteBordereau: qtyBordereau,
          totalPartiel: Number(data.totalPartiel) || 0,
          totalCumule: totalCumule,
          pourcentageRealisation: isNaN(pourcentage) ? 0 : pourcentage,
        };
      });

      // Sort by reference
      result.sort((a, b) => {
        const numA = parseInt(a.reference.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.reference.replace(/\D/g, '')) || 0;
        return numA - numB;
      });

      return result;
    },
    [normalizedId]
  );

  return {
    aggregatedMetres: aggregatedMetres || [],
    isLoading: aggregatedMetres === undefined,
    refresh: async () => {},
  };
};

/**
 * Electron: Combined project data
 */
const useElectronProjectData = (projectId: string | null, _userId: string | null) => {
  const { project, isLoading: projectLoading } = useElectronProject(projectId);
  const { bordereaux, bordereau, isLoading: bordereauxLoading } = useElectronBordereaux(projectId);
  const { periodes, isLoading: periodesLoading } = useElectronPeriodes(projectId);
  const { metres, isLoading: metresLoading } = useElectronMetres(projectId);
  const { decompts, isLoading: decomptsLoading } = useElectronDecompts(projectId);

  return {
    project,
    bordereaux,
    bordereau,
    periodes,
    metres,
    decompts,
    isLoading: projectLoading || bordereauxLoading || periodesLoading || metresLoading || decomptsLoading,
    error: null,
    refresh: async () => {},
  };
};

// ==================== UNIFIED HOOKS ====================

/**
 * 🔴 Projects Hook - اختيار تلقائي حسب المنصة
 */
export const useProjects = (userId: string | null) => {
  if (isWeb()) {
    return useWebProjects(userId);
  }
  return useElectronProjects(userId);
};

/**
 * 🔴 Single Project Hook
 */
export const useProject = (projectId: string | null) => {
  if (isWeb()) {
    return useWebProject(projectId);
  }
  return useElectronProject(projectId);
};

/**
 * 🔴 Bordereaux Hook
 */
export const useBordereaux = (projectId: string | null) => {
  if (isWeb()) {
    return useWebBordereaux(projectId);
  }
  return useElectronBordereaux(projectId);
};

/**
 * 🔴 Périodes Hook
 */
export const usePeriodes = (projectId: string | null) => {
  if (isWeb()) {
    return useWebPeriodes(projectId);
  }
  return useElectronPeriodes(projectId);
};

/**
 * 🔴 Métrés Hook
 */
export const useMetres = (projectId: string | null, periodeId?: string | null) => {
  if (isWeb()) {
    return useWebMetres(projectId, periodeId);
  }
  return useElectronMetres(projectId, periodeId);
};

/**
 * 🔴 Décomptes Hook
 */
export const useDecompts = (projectId: string | null) => {
  if (isWeb()) {
    return useWebDecompts(projectId);
  }
  return useElectronDecompts(projectId);
};

/**
 * 🔴 Photos Hook
 */
export const usePhotos = (projectId: string | null) => {
  if (isWeb()) {
    return useWebPhotos(projectId);
  }
  return useElectronPhotos(projectId);
};

/**
 * 🔴 PVs Hook
 */
export const usePvs = (projectId: string | null) => {
  if (isWeb()) {
    return useWebPvs(projectId);
  }
  return useElectronPvs(projectId);
};

/**
 * 🔴 Attachments Hook
 */
export const useAttachments = (projectId: string | null) => {
  if (isWeb()) {
    return useWebAttachments(projectId);
  }
  return useElectronAttachments(projectId);
};

/**
 * 🔴 Aggregated Métrés Hook
 */
export const useAggregatedMetres = (projectId: string | null) => {
  if (isWeb()) {
    return useWebAggregatedMetres(projectId);
  }
  return useElectronAggregatedMetres(projectId);
};

/**
 * 🔴 Combined Project Data Hook
 */
export const useProjectData = (projectId: string | null, userId: string | null) => {
  if (isWeb()) {
    return useWebProjectData(projectId, userId);
  }
  return useElectronProjectData(projectId, userId);
};

/**
 * 🔴 Online Status Hook
 */
export { useOnlineStatus };

/**
 * 🔴 Check if can modify data
 * Web: must be online
 * Electron: always can (offline-first)
 */
export const useCanModify = () => {
  const isOnline = useOnlineStatus();
  
  if (isElectron()) {
    return { canModify: true, reason: null };
  }
  
  if (!isOnline) {
    return { 
      canModify: false, 
      reason: 'Vous devez être connecté pour créer ou modifier des données' 
    };
  }
  
  return { canModify: true, reason: null };
};
