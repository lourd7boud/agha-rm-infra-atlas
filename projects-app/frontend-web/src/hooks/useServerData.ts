/**
 * useServerData Hook - Server-First Data Loading for Web
 * 
 * On Web: Always fetch from server, cache locally only for display during current session
 * On Electron: Use offline-first with IndexedDB as primary source
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { apiService } from '../services/apiService';
import { isWeb, isElectron } from '../utils/platform';
import { normalizeEntityId, cleanEntityId } from './useSyncManagerCore';
import { isOnline } from '../services/syncService';

interface ServerDataState {
  isLoading: boolean;
  error: string | null;
  isOnline: boolean;
  lastRefresh: number | null;
}

/**
 * Hook for loading projects with server-first behavior on Web
 */
export const useServerProjects = (userId: string | null) => {
  const [state, setState] = useState<ServerDataState>({
    isLoading: true,
    error: null,
    isOnline: isOnline(),
    lastRefresh: null,
  });
  const loadedRef = useRef(false);

  // Normalize userId variants for querying - MEMOIZED to prevent infinite loops
  const userIdVariants = useMemo(() => {
    if (!userId) return [];
    return [
      userId,
      userId.includes(':') ? userId.split(':').pop()! : userId,
      userId.includes(':') ? userId : `user:${userId}`,
    ];
  }, [userId]);

  // Live query from IndexedDB (for reactivity)
  const localProjects = useLiveQuery(
    async () => {
      if (!userId) return [];
      const allProjects = await db.projects.filter(p => !p.deletedAt).toArray();
      return allProjects.filter(p => userIdVariants.includes(p.userId));
    },
    [userId, userIdVariants]
  );

  // Load from server (Web mode) or use cache (Electron mode)
  const loadFromServer = useCallback(async () => {
    if (!userId) return;

    // On Web: ALWAYS load from server when online
    // On Electron: Only load if no local data or explicitly requested
    if (isWeb() && !isOnline()) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Vous devez être connecté pour voir les données',
        isOnline: false,
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log('📥 [SERVER-FIRST] Loading projects from server...');
      const response = await apiService.getProjects();
      const serverProjects = response.data || response;

      if (Array.isArray(serverProjects)) {
        // Clear old projects for this user and insert fresh data
        await db.transaction('rw', db.projects, async () => {
          // Delete all projects for this user
          const existingProjects = await db.projects
            .filter(p => userIdVariants.includes(p.userId))
            .toArray();
          
          for (const p of existingProjects) {
            await db.projects.delete(p.id);
          }

          // Insert fresh data from server
          for (const project of serverProjects) {
            const normalizedId = normalizeEntityId('project', project.id);
            await db.projects.put({
              ...project,
              id: normalizedId,
              userId: project.userId ? normalizeEntityId('user', project.userId) : project.userId,
            });
          }
        });

        console.log(`✅ [SERVER-FIRST] Loaded ${serverProjects.length} projects from server`);
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: null,
        isOnline: true,
        lastRefresh: Date.now(),
      }));
    } catch (error: any) {
      console.error('❌ [SERVER-FIRST] Failed to load projects:', error);
      
      // On Electron, fall back to local data
      if (isElectron()) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: null, // Don't show error on Electron - use local data
          isOnline: false,
        }));
      } else {
        // On Web, show error if server fails
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Impossible de charger les données du serveur',
          isOnline: false,
        }));
      }
    }
  }, [userId, userIdVariants]); // userIdVariants is now memoized, so this is safe

  // Initial load
  useEffect(() => {
    if (userId && !loadedRef.current) {
      loadedRef.current = true;
      
      // On Web: Always load from server
      // On Electron: Load from server if online, otherwise use cache
      if (isWeb() || isOnline()) {
        loadFromServer();
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    }
  }, [userId, loadFromServer]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      if (isWeb()) {
        loadFromServer();
      }
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadFromServer]);

  return {
    projects: localProjects || [],
    ...state,
    refresh: loadFromServer,
  };
};

/**
 * Hook for loading project details with all related data
 */
export const useServerProjectDetails = (projectId: string | null, userId: string | null) => {
  const [state, setState] = useState<ServerDataState>({
    isLoading: true,
    error: null,
    isOnline: isOnline(),
    lastRefresh: null,
  });
  const loadedRef = useRef(false);

  const normalizedProjectId = projectId ? normalizeEntityId('project', projectId) : null;
  const cleanProjectId = projectId ? cleanEntityId(projectId) : null;

  // Live queries from IndexedDB
  const project = useLiveQuery(
    () => normalizedProjectId ? db.projects.get(normalizedProjectId) : undefined,
    [normalizedProjectId]
  );

  const bordereaux = useLiveQuery(
    async () => {
      if (!normalizedProjectId) return [];
      return db.bordereaux.where('projectId').equals(normalizedProjectId).filter(b => !b.deletedAt).toArray();
    },
    [normalizedProjectId]
  );

  const periodes = useLiveQuery(
    async () => {
      if (!normalizedProjectId) return [];
      return db.periodes.where('projectId').equals(normalizedProjectId).filter(p => !p.deletedAt).toArray();
    },
    [normalizedProjectId]
  );

  const metres = useLiveQuery(
    async () => {
      if (!normalizedProjectId) return [];
      return db.metres.where('projectId').equals(normalizedProjectId).filter(m => !m.deletedAt).toArray();
    },
    [normalizedProjectId]
  );

  const decompts = useLiveQuery(
    async () => {
      if (!normalizedProjectId) return [];
      return db.decompts.where('projectId').equals(normalizedProjectId).filter(d => !d.deletedAt).toArray();
    },
    [normalizedProjectId]
  );

  // Load from server
  const loadFromServer = useCallback(async () => {
    if (!cleanProjectId || !userId) return;

    if (isWeb() && !isOnline()) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Vous devez être connecté pour voir les données',
        isOnline: false,
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log(`📥 [SERVER-FIRST] Loading project ${cleanProjectId} details from server...`);

      // Load project
      const projectResponse = await apiService.getProject(cleanProjectId);
      const serverProject = projectResponse.data || projectResponse;

      if (serverProject) {
        await db.projects.put({
          ...serverProject,
          id: normalizeEntityId('project', serverProject.id),
          userId: serverProject.userId ? normalizeEntityId('user', serverProject.userId) : serverProject.userId,
        });
      }

      // Load bordereaux
      try {
        const bordereauxResponse = await apiService.getBordereaux(cleanProjectId);
        const serverBordereaux = bordereauxResponse.data || bordereauxResponse;
        if (Array.isArray(serverBordereaux)) {
          await db.transaction('rw', db.bordereaux, async () => {
            // Clear existing and insert fresh
            const existing = await db.bordereaux.where('projectId').equals(normalizedProjectId!).toArray();
            for (const b of existing) await db.bordereaux.delete(b.id);
            
            for (const b of serverBordereaux) {
              await db.bordereaux.put({
                ...b,
                id: normalizeEntityId('bordereau', b.id),
                projectId: normalizedProjectId!,
              });
            }
          });
        }
      } catch (e) { /* No bordereaux */ }

      // Load periodes
      try {
        const periodesResponse = await apiService.getPeriodes?.(cleanProjectId);
        const serverPeriodes = periodesResponse?.data || periodesResponse;
        if (Array.isArray(serverPeriodes)) {
          await db.transaction('rw', db.periodes, async () => {
            const existing = await db.periodes.where('projectId').equals(normalizedProjectId!).toArray();
            for (const p of existing) await db.periodes.delete(p.id);
            
            for (const p of serverPeriodes) {
              await db.periodes.put({
                ...p,
                id: normalizeEntityId('periode', p.id),
                projectId: normalizedProjectId!,
              });
            }
          });
        }
      } catch (e) { /* No periodes */ }

      // Load metres
      try {
        const metresResponse = await apiService.getMetres(cleanProjectId);
        const serverMetres = metresResponse.data || metresResponse;
        if (Array.isArray(serverMetres)) {
          await db.transaction('rw', db.metres, async () => {
            const existing = await db.metres.where('projectId').equals(normalizedProjectId!).toArray();
            for (const m of existing) await db.metres.delete(m.id);
            
            for (const m of serverMetres) {
              await db.metres.put({
                ...m,
                id: normalizeEntityId('metre', m.id),
                projectId: normalizedProjectId!,
                periodeId: m.periodeId ? normalizeEntityId('periode', m.periodeId) : '',
              });
            }
          });
        }
      } catch (e) { /* No metres */ }

      // Load decompts
      try {
        const decomptsResponse = await apiService.getDecompts(cleanProjectId);
        const serverDecompts = decomptsResponse.data || decomptsResponse;
        if (Array.isArray(serverDecompts)) {
          await db.transaction('rw', db.decompts, async () => {
            const existing = await db.decompts.where('projectId').equals(normalizedProjectId!).toArray();
            for (const d of existing) await db.decompts.delete(d.id);
            
            for (const d of serverDecompts) {
              await db.decompts.put({
                ...d,
                id: normalizeEntityId('decompt', d.id),
                projectId: normalizedProjectId!,
                periodeId: d.periodeId ? normalizeEntityId('periode', d.periodeId) : '',
              });
            }
          });
        }
      } catch (e) { /* No decompts */ }

      console.log(`✅ [SERVER-FIRST] Loaded project ${cleanProjectId} with all related data`);

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: null,
        isOnline: true,
        lastRefresh: Date.now(),
      }));
    } catch (error: any) {
      console.error('❌ [SERVER-FIRST] Failed to load project details:', error);
      
      if (isElectron()) {
        setState(prev => ({ ...prev, isLoading: false, error: null }));
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Impossible de charger les données du serveur',
        }));
      }
    }
  }, [cleanProjectId, normalizedProjectId, userId]);

  // Initial load
  useEffect(() => {
    if (cleanProjectId && userId && !loadedRef.current) {
      loadedRef.current = true;
      
      if (isWeb() || isOnline()) {
        loadFromServer();
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    }
  }, [cleanProjectId, userId, loadFromServer]);

  return {
    project,
    bordereaux: bordereaux || [],
    periodes: periodes || [],
    metres: metres || [],
    decompts: decompts || [],
    ...state,
    refresh: loadFromServer,
  };
};

/**
 * Check if user can create/edit data
 * Web: Must be online
 * Electron: Can work offline
 */
export const useCanModify = (): { canModify: boolean; reason: string | null } => {
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Electron can always modify (offline-first)
  if (isElectron()) {
    return { canModify: true, reason: null };
  }

  // Web requires online connection
  if (!online) {
    return { 
      canModify: false, 
      reason: 'Vous devez être connecté pour créer ou modifier des données' 
    };
  }

  return { canModify: true, reason: null };
};
