/**
 * Data Hooks - Read data from Dexie with proper ID normalization
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';

// ==================== ID UTILITIES ====================

/**
 * Normalize entity ID to include prefix
 */
export const normalizeId = (entity: string, id: string): string => {
  if (!id) return '';
  const cleanId = id.includes(':') ? id.split(':').pop()! : id;
  return `${entity}:${cleanId}`;
};

/**
 * Clean entity ID (remove prefix)
 */
export const cleanId = (id: string): string => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop()! : id;
};

// ==================== PROJECT HOOKS ====================

/**
 * Get a single project by ID
 * Handles both prefixed and non-prefixed IDs
 */
export const useProject = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return null;
    
    // Try with prefix first
    const normalizedId = normalizeId('project', projectId);
    let project = await db.projects.get(normalizedId);
    
    // If not found, try without prefix
    if (!project) {
      project = await db.projects.get(projectId);
    }
    
    // If still not found, try with clean ID
    if (!project) {
      const cleanProjectId = cleanId(projectId);
      project = await db.projects.get(cleanProjectId);
    }
    
    return project || null;
  }, [projectId]);
};

/**
 * Get all projects for a user
 */
export const useProjects = (userId: string | undefined, includeDeleted = false) => {
  return useLiveQuery(async () => {
    if (!userId) return [];
    
    const normalizedUserId = normalizeId('user', userId);
    
    let query = db.projects.filter(p => {
      const userMatches = p.userId === normalizedUserId || 
                         p.userId === userId || 
                         p.userId === cleanId(userId);
      
      if (includeDeleted) return userMatches;
      return userMatches && !p.deletedAt;
    });
    
    return await query.toArray();
  }, [userId, includeDeleted]);
};

// ==================== BORDEREAU HOOKS ====================

/**
 * Get bordereau for a project
 */
export const useBordereau = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return null;
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    // Try all possible ID formats
    let bordereau = await db.bordereaux
      .where('projectId')
      .equals(normalizedProjectId)
      .and(b => !b.deletedAt)
      .first();
    
    if (!bordereau) {
      bordereau = await db.bordereaux
        .where('projectId')
        .equals(projectId)
        .and(b => !b.deletedAt)
        .first();
    }
    
    if (!bordereau) {
      bordereau = await db.bordereaux
        .where('projectId')
        .equals(cleanProjectId)
        .and(b => !b.deletedAt)
        .first();
    }
    
    return bordereau || null;
  }, [projectId]);
};

/**
 * Get all bordereaux for a project
 */
export const useBordereaux = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    // Get all matching any ID format
    const allBordereaux = await db.bordereaux.toArray();
    
    return allBordereaux.filter(b => {
      const idMatches = b.projectId === normalizedProjectId ||
                       b.projectId === projectId ||
                       b.projectId === cleanProjectId;
      return idMatches && !b.deletedAt;
    });
  }, [projectId]);
};

// ==================== PERIODE HOOKS ====================

/**
 * Get all periodes for a project
 */
export const usePeriodes = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    const allPeriodes = await db.periodes.toArray();
    
    return allPeriodes
      .filter(p => {
        const idMatches = p.projectId === normalizedProjectId ||
                         p.projectId === projectId ||
                         p.projectId === cleanProjectId;
        return idMatches && !p.deletedAt;
      })
      .sort((a, b) => (b.numero || 0) - (a.numero || 0));
  }, [projectId]);
};

/**
 * Get a single periode by ID
 */
export const usePeriode = (periodeId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!periodeId) return null;
    
    const normalizedId = normalizeId('periode', periodeId);
    
    let periode = await db.periodes.get(normalizedId);
    if (!periode) {
      periode = await db.periodes.get(periodeId);
    }
    if (!periode) {
      periode = await db.periodes.get(cleanId(periodeId));
    }
    
    return periode || null;
  }, [periodeId]);
};

// ==================== METRE HOOKS ====================

/**
 * Get all metres for a project
 */
export const useMetres = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    const allMetres = await db.metres.toArray();
    
    return allMetres.filter(m => {
      const idMatches = m.projectId === normalizedProjectId ||
                       m.projectId === projectId ||
                       m.projectId === cleanProjectId;
      return idMatches && !m.deletedAt;
    });
  }, [projectId]);
};

/**
 * Get metres for a specific periode
 */
export const useMetresByPeriode = (periodeId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!periodeId) return [];
    
    const normalizedPeriodeId = normalizeId('periode', periodeId);
    const cleanPeriodeId = cleanId(periodeId);
    
    const allMetres = await db.metres.toArray();
    
    return allMetres.filter(m => {
      const idMatches = m.periodeId === normalizedPeriodeId ||
                       m.periodeId === periodeId ||
                       m.periodeId === cleanPeriodeId;
      return idMatches && !m.deletedAt;
    });
  }, [periodeId]);
};

// ==================== DECOMPT HOOKS ====================

/**
 * Get all decompts for a project
 */
export const useDecompts = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    const allDecompts = await db.decompts.toArray();
    
    return allDecompts.filter(d => {
      const idMatches = d.projectId === normalizedProjectId ||
                       d.projectId === projectId ||
                       d.projectId === cleanProjectId;
      return idMatches && !d.deletedAt;
    });
  }, [projectId]);
};

/**
 * Get decompts for a specific periode
 */
export const useDecomptsByPeriode = (periodeId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!periodeId) return [];
    
    const normalizedPeriodeId = normalizeId('periode', periodeId);
    const cleanPeriodeId = cleanId(periodeId);
    
    const allDecompts = await db.decompts.toArray();
    
    return allDecompts.filter(d => {
      const idMatches = d.periodeId === normalizedPeriodeId ||
                       d.periodeId === periodeId ||
                       d.periodeId === cleanPeriodeId;
      return idMatches && !d.deletedAt;
    });
  }, [periodeId]);
};

// ==================== COUNTS ====================

/**
 * Get counts of all entities for a project
 */
export const useProjectCounts = (projectId: string | undefined) => {
  return useLiveQuery(async () => {
    if (!projectId) return { bordereaux: 0, metres: 0, decompts: 0, periodes: 0 };
    
    const normalizedProjectId = normalizeId('project', projectId);
    const cleanProjectId = cleanId(projectId);
    
    const matchesProject = (entityProjectId: string) => {
      return entityProjectId === normalizedProjectId ||
             entityProjectId === projectId ||
             entityProjectId === cleanProjectId;
    };
    
    const allBordereaux = await db.bordereaux.toArray();
    const allMetres = await db.metres.toArray();
    const allDecompts = await db.decompts.toArray();
    const allPeriodes = await db.periodes.toArray();
    
    return {
      bordereaux: allBordereaux.filter(b => matchesProject(b.projectId) && !b.deletedAt).length,
      metres: allMetres.filter(m => matchesProject(m.projectId) && !m.deletedAt).length,
      decompts: allDecompts.filter(d => matchesProject(d.projectId) && !d.deletedAt).length,
      periodes: allPeriodes.filter(p => matchesProject(p.projectId) && !p.deletedAt).length,
    };
  }, [projectId]);
};

// ==================== LOADING STATE WRAPPER ====================

/**
 * Hook to handle loading states properly
 * Returns loading=false and empty data if no data found (instead of staying in loading)
 */
export const useDataWithFallback = <T>(
  data: T | undefined,
  fallbackValue: T
): { data: T; isLoading: boolean } => {
  // useLiveQuery returns undefined while loading
  const isLoading = data === undefined;
  return {
    data: data ?? fallbackValue,
    isLoading,
  };
};
