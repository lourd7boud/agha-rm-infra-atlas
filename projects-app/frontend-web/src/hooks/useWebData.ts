/**
 * useWebData - Server-First Data Hooks for Web
 * 
 * 🔴 هذا الملف مخصص للـ WEB فقط
 * 🔴 لا IndexedDB، لا Dexie، لا useLiveQuery
 * 🔴 فقط useState + fetch من السيرفر
 * 
 * القاعدة: Web = واجهة عرض وإدارة فقط، وليس نظام تخزين
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/apiService';

// ==================== TYPES ====================

export interface Project {
  id: string;
  userId: string;
  objet: string;
  marcheNo: string;
  annee: string;
  dateOuverture: string;
  montant: number;
  typeMarche?: 'normal' | 'negocie';
  commune?: string;
  societe?: string;
  rc?: string;
  cb?: string;
  cnss?: string;
  patente?: string;
  programme?: string;
  projet?: string;
  ligne?: string;
  chapitre?: string;
  ordreService?: string;
  delaisExecution?: number;
  assistanceTechnique?: string;
  maitreOeuvre?: string;
  osc?: string;
  arrets?: Array<{
    id: string;
    dateArret: string;
    dateReprise?: string;
    motif: string;
  }>;
  dateReceptionProvisoire?: string;
  dateReceptionDefinitive?: string;
  achevementTravaux?: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  progress: number;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface BordereauLigne {
  id: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

export interface Bordereau {
  id: string;
  projectId: string;
  userId: string;
  reference: string;
  designation: string;
  lignes: BordereauLigne[];
  montantTotal: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Periode {
  id: string;
  projectId: string;
  userId: string;
  numero: number;
  libelle?: string;
  dateDebut: string;
  dateFin: string;
  statut?: 'en_cours' | 'validee' | 'facturee';
  isDecompteDernier?: boolean;
  observations?: string;
  // Paramètres financiers du décompte
  tauxTVA?: number;
  tauxRetenue?: number;
  depensesExercicesAnterieurs?: number;
  decomptesPrecedents?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface MetreSection {
  id: string;
  metreId: string;
  name: string;
  order: number;
  createdAt: string;
}

export interface MetreSubSection {
  id: string;
  sectionId: string;
  metreId: string;
  name: string;
  order: number;
  createdAt: string;
}

export interface MetreLigne {
  id: string;
  metreId: string;
  sectionId?: string;
  subSectionId?: string;
  numero: number;
  designation: string;
  nombreSemblables?: number;
  nombreElements?: number;
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  partiel: number;
  observations?: string;
  createdAt: string;
}

export interface Metre {
  id: string;
  projectId: string;
  periodeId: string;
  userId: string;
  bordereauLigneId: string;
  sections: MetreSection[];
  subSections: MetreSubSection[];
  lignes: MetreLigne[];
  cumulPrecedent: number;
  quantitePeriode: number;
  cumulActuel: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Decompt {
  id: string;
  projectId: string;
  periodeId: string;
  userId: string;
  numero: number;
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
  statut: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// ==================== PROJECTS HOOK ====================

/**
 * Hook لجلب المشاريع من السيرفر مباشرة
 * لا IndexedDB، لا cache، فقط السيرفر
 */
export const useWebProjects = (userId: string | null) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const currentUserIdRef = useRef<string | null>(null);

  const fetchProjects = useCallback(async (showLoading = true) => {
    if (!userId) {
      setProjects([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      console.log('🌐 [WEB] Fetching projects from server...');
      const response = await apiService.getProjects();
      
      if (!mountedRef.current) return;
      
      const projectsData = (response.data || response) as Project[];
      
      // Filter non-deleted projects
      const activeProjects = projectsData.filter(p => !p.deletedAt);
      
      console.log(`✅ [WEB] Loaded ${activeProjects.length} projects from server`);
      
      setProjects(activeProjects);
      setIsLoading(false);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error('❌ [WEB] Failed to fetch projects:', err);
      setIsLoading(false);
      setError(err.response?.status === 401 
        ? 'Session expirée, veuillez vous reconnecter'
        : 'Impossible de charger les projets');
    }
  }, [userId]);

  // Initial fetch when userId changes
  useEffect(() => {
    mountedRef.current = true;
    
    // Only fetch if userId changed
    if (userId !== currentUserIdRef.current) {
      currentUserIdRef.current = userId;
      fetchProjects(true);
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [userId, fetchProjects]);

  return {
    projects,
    isLoading,
    error,
    refresh: () => fetchProjects(true),
    silentRefresh: () => fetchProjects(false),
  };
};

// ==================== SINGLE PROJECT HOOK ====================

/**
 * Hook لجلب مشروع واحد مع كل البيانات المرتبطة
 */
export const useWebProject = (projectId: string | null) => {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchProject = useCallback(async () => {
    if (!cleanId) {
      setProject(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🌐 [WEB] Fetching project ${cleanId}...`);
      const response = await apiService.getProject(cleanId);
      
      if (!mountedRef.current) return;
      
      const data = response.data || response;
      setProject(data);
      console.log(`✅ [WEB] Loaded project ${cleanId}`, data);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error(`❌ [WEB] Failed to fetch project ${cleanId}:`, err);
      setError('Impossible de charger le projet');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cleanId]);

  // Fetch on mount and when cleanId changes
  useEffect(() => {
    mountedRef.current = true;
    fetchProject();
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchProject]);

  return { project, isLoading, error, refresh: fetchProject };
};

// ==================== BORDEREAUX HOOK ====================

/**
 * Hook لجلب bordereaux لمشروع معين
 */
export const useWebBordereaux = (projectId: string | null) => {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchBordereaux = useCallback(async () => {
    if (!cleanId) {
      setBordereaux([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🌐 [WEB] Fetching bordereaux for project ${cleanId}...`);
      const response = await apiService.getBordereaux(cleanId);
      
      if (!mountedRef.current) return;
      
      const bordereauxData = (response.data || response) as Bordereau[];
      console.log(`✅ [WEB] Loaded ${bordereauxData.length} bordereaux`);
      setBordereaux(bordereauxData.filter(b => !b.deletedAt));
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error(`❌ [WEB] Failed to fetch bordereaux:`, err);
      setError('Impossible de charger le bordereau');
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [cleanId]);

  // Initial fetch - set mounted on mount, clear on unmount
  useEffect(() => {
    mountedRef.current = true;
    fetchBordereaux();
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchBordereaux]);

  return {
    bordereaux,
    bordereau: bordereaux[0] || null, // Usually one per project
    isLoading,
    error,
    refresh: fetchBordereaux,
  };
};

// ==================== PERIODES HOOK ====================

/**
 * Hook لجلب périodes لمشروع معين
 */
export const useWebPeriodes = (projectId: string | null) => {
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchPeriodes = useCallback(async () => {
    if (!cleanId) {
      setPeriodes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🌐 [WEB] Fetching périodes for project ${cleanId}...`);
      const response = await apiService.getPeriodes(cleanId);
      
      if (!mountedRef.current) return;
      
      const periodesData = (response.data || response) as Periode[];
      
      // Sort by numero
      const sorted = periodesData
        .filter(p => !p.deletedAt)
        .sort((a, b) => a.numero - b.numero);
      
      setPeriodes(sorted);
      setIsLoading(false);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error(`❌ [WEB] Failed to fetch périodes:`, err);
      setIsLoading(false);
      // Don't set error - périodes might not exist yet
      setPeriodes([]);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchPeriodes();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchPeriodes]);

  return {
    periodes,
    isLoading,
    error,
    refresh: fetchPeriodes,
  };
};

// ==================== METRES HOOK ====================

/**
 * Hook لجلب métrés لمشروع معين
 */
export const useWebMetres = (projectId: string | null, periodeId?: string | null) => {
  const [metres, setMetres] = useState<Metre[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const currentIdsRef = useRef<string>('');

  const cleanProjectId = projectId?.replace('project:', '') || null;
  const cleanPeriodeId = periodeId?.replace('periode:', '') || null;
  const idsKey = `${cleanProjectId}-${cleanPeriodeId}`;

  const fetchMetres = useCallback(async () => {
    if (!cleanProjectId) {
      setMetres([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🌐 [WEB] Fetching métrés for project ${cleanProjectId}...`);
      const response = await apiService.getMetres(cleanProjectId);
      
      if (!mountedRef.current) return;
      
      let metresData = (response.data || response) as Metre[];
      
      console.log(`📊 [WEB] Loaded ${metresData.length} métrés, filtering by periodeId: ${cleanPeriodeId}`);
      console.log('📊 [WEB] Metres periodeIds:', metresData.map(m => m.periodeId));
      
      // Filter by periode if specified
      if (cleanPeriodeId) {
        metresData = metresData.filter(m => {
          const metrePeriodeId = (m.periodeId || '').replace('periode:', '');
          return metrePeriodeId === cleanPeriodeId;
        });
        console.log(`📊 [WEB] After filtering: ${metresData.length} métrés`);
      }
      
      setMetres(metresData.filter(m => !m.deletedAt));
      setIsLoading(false);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error(`❌ [WEB] Failed to fetch métrés:`, err);
      setIsLoading(false);
      setMetres([]);
    }
  }, [cleanProjectId, cleanPeriodeId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (idsKey !== currentIdsRef.current) {
      currentIdsRef.current = idsKey;
      fetchMetres();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [idsKey, fetchMetres]);

  return {
    metres,
    isLoading,
    error,
    refresh: fetchMetres,
  };
};

// ==================== DECOMPTS HOOK ====================

/**
 * Hook لجلب décomptes لمشروع معين
 */
export const useWebDecompts = (projectId: string | null) => {
  const [decompts, setDecompts] = useState<Decompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchDecompts = useCallback(async () => {
    if (!cleanId) {
      setDecompts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🌐 [WEB] Fetching décomptes for project ${cleanId}...`);
      const response = await apiService.getDecompts(cleanId);
      
      if (!mountedRef.current) return;
      
      const decomptsData = (response.data || response) as Decompt[];
      setDecompts(decomptsData.filter(d => !d.deletedAt));
      setIsLoading(false);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      console.error(`❌ [WEB] Failed to fetch décomptes:`, err);
      setIsLoading(false);
      setDecompts([]);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchDecompts();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchDecompts]);

  return {
    decompts,
    isLoading,
    error,
    refresh: fetchDecompts,
  };
};

// ==================== COMBINED PROJECT DATA HOOK ====================

/**
 * Hook لجلب كل بيانات مشروع معين دفعة واحدة
 */
export const useWebProjectData = (projectId: string | null, _userId: string | null) => {
  const { project, isLoading: projectLoading, error: projectError, refresh: refreshProject } = useWebProject(projectId);
  const { bordereaux, bordereau, isLoading: bordereauxLoading, refresh: refreshBordereaux } = useWebBordereaux(projectId);
  const { periodes, isLoading: periodesLoading, refresh: refreshPeriodes } = useWebPeriodes(projectId);
  const { metres, isLoading: metresLoading, refresh: refreshMetres } = useWebMetres(projectId);
  const { decompts, isLoading: decomptsLoading, refresh: refreshDecompts } = useWebDecompts(projectId);

  const isLoading = projectLoading || bordereauxLoading || periodesLoading || metresLoading || decomptsLoading;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshProject(),
      refreshBordereaux(),
      refreshPeriodes(),
      refreshMetres(),
      refreshDecompts(),
    ]);
  }, [refreshProject, refreshBordereaux, refreshPeriodes, refreshMetres, refreshDecompts]);

  return {
    project,
    bordereaux,
    bordereau,
    periodes,
    metres,
    decompts,
    isLoading,
    error: projectError,
    refresh: refreshAll,
  };
};

// ==================== PHOTOS HOOK ====================

export interface Photo {
  id: string;
  projectId: string;
  userId: string;
  filename: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const useWebPhotos = (projectId: string | null) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchPhotos = useCallback(async () => {
    if (!cleanId) {
      setPhotos([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiService.getPhotos(cleanId);
      
      if (!mountedRef.current) return;
      
      const data = (response.data || response) as Photo[];
      setPhotos(data.filter(p => !p.deletedAt));
    } catch (err) {
      if (!mountedRef.current) return;
      console.error(`❌ [WEB] Failed to fetch photos:`, err);
      setPhotos([]);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchPhotos();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchPhotos]);

  return { photos, isLoading, refresh: fetchPhotos };
};

// ==================== PVS HOOK ====================

export interface PV {
  id: string;
  projectId: string;
  userId: string;
  type: string;
  numero: number;
  date: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const useWebPvs = (projectId: string | null) => {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchPvs = useCallback(async () => {
    if (!cleanId) {
      setPvs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiService.getPVs(cleanId);
      
      if (!mountedRef.current) return;
      
      const data = (response.data || response) as PV[];
      setPvs(data.filter(p => !p.deletedAt));
    } catch (err) {
      if (!mountedRef.current) return;
      console.error(`❌ [WEB] Failed to fetch PVs:`, err);
      setPvs([]);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchPvs();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchPvs]);

  return { pvs, isLoading, refresh: fetchPvs };
};

// ==================== ATTACHMENTS HOOK ====================

export interface Attachment {
  id: string;
  projectId: string;
  userId: string;
  filename: string;
  path: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const useWebAttachments = (projectId: string | null) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchAttachments = useCallback(async () => {
    if (!cleanId) {
      setAttachments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiService.getAttachments(cleanId);
      
      if (!mountedRef.current) return;
      
      const data = (response.data || response) as Attachment[];
      setAttachments(data.filter(a => !a.deletedAt));
    } catch (err) {
      if (!mountedRef.current) return;
      console.error(`❌ [WEB] Failed to fetch attachments:`, err);
      setAttachments([]);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchAttachments();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchAttachments]);

  return { attachments, isLoading, refresh: fetchAttachments };
};

// ==================== AGGREGATED METRES HOOK ====================

export interface AggregatedMetre {
  id: string;
  reference: string;
  designationBordereau: string;
  unite: string;
  quantiteBordereau: number;
  totalPartiel: number;
  totalCumule: number;
  pourcentageRealisation: number;
}

export const useWebAggregatedMetres = (projectId: string | null) => {
  const [aggregatedMetres, setAggregatedMetres] = useState<AggregatedMetre[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);

  const cleanId = projectId?.replace('project:', '') || null;

  const fetchAggregatedMetres = useCallback(async () => {
    if (!cleanId) {
      setAggregatedMetres([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      // Fetch metres and periodes
      const [metresRes, periodesRes] = await Promise.all([
        apiService.getMetres(cleanId),
        apiService.getPeriodes(cleanId),
      ]);
      
      if (!mountedRef.current) return;
      
      const allMetres = ((metresRes.data || metresRes) as any[]).filter(m => !m.deletedAt);
      const allPeriodes = ((periodesRes.data || periodesRes) as any[]).filter(p => !p.deletedAt);
      
      if (allMetres.length === 0) {
        setAggregatedMetres([]);
        setIsLoading(false);
        return;
      }

      // Sort périodes by numero descending to find the latest
      const sortedPeriodes = allPeriodes.sort((a: any, b: any) => b.numero - a.numero);
      const latestPeriodeId = sortedPeriodes.length > 0 ? sortedPeriodes[0].id : null;
      const latestPeriodeIdNormalized = latestPeriodeId?.replace('periode:', '');

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
        const normalizedId = normalizeBordereauLigneId(metre.bordereauLigneId);
        const metresPeriodeId = metre.periodeId?.replace('periode:', '');
        const isLatest = metresPeriodeId === latestPeriodeIdNormalized || metre.periodeId === latestPeriodeId;
        
        const existing = groupedMap.get(normalizedId);
        if (existing) {
          existing.totalCumule += metre.totalPartiel || 0;
          if (isLatest) {
            existing.totalPartiel = metre.totalPartiel || 0;
          }
        } else {
          groupedMap.set(normalizedId, {
            reference: metre.reference,
            designationBordereau: metre.designationBordereau,
            unite: metre.unite,
            quantiteBordereau: metre.quantiteBordereau,
            totalCumule: metre.totalPartiel || 0,
            totalPartiel: isLatest ? (metre.totalPartiel || 0) : 0,
          });
        }
      }

      // Convert to array and calculate pourcentageRealisation
      const result = Array.from(groupedMap.entries()).map(([normalizedId, data]) => {
        const qtyBordereau = Number(data.quantiteBordereau) || 0;
        const totalCumule = Number(data.totalCumule) || 0;
        const pourcentage = qtyBordereau > 0 ? (totalCumule / qtyBordereau) * 100 : 0;
        // 🔴 Fix: handle null reference
        const refStr = data.reference || normalizedId || '';
        const refParts = refStr.split('-');
        const cleanRef = refParts.length > 0 ? refParts[refParts.length - 1] : refStr;
        return {
          id: normalizedId,
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

      setAggregatedMetres(result);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error(`❌ [WEB] Failed to fetch aggregated métrés:`, err);
      setAggregatedMetres([]);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cleanId]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (cleanId !== currentIdRef.current) {
      currentIdRef.current = cleanId;
      fetchAggregatedMetres();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [cleanId, fetchAggregatedMetres]);

  return { aggregatedMetres, isLoading, refresh: fetchAggregatedMetres };
};

// ==================== UTILITY: CHECK ONLINE STATUS ====================

export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};
