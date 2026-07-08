/**
 * Intervenant Service
 * Gère la sauvegarde et la récupération automatique des intervenants
 * (Assistance Technique et Maître d'Oeuvre)
 * Les intervenants sont extraits des projets existants
 */

import { apiService } from './apiService';

export interface Intervenant {
  id: string;
  nom: string;
  type: 'assistanceTechnique' | 'maitreOeuvre';
  usageCount: number;
}

// Cache pour les intervenants
let intervenantsCache: Intervenant[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 secondes

/**
 * Récupérer les intervenants depuis les projets du serveur
 */
const fetchIntervenants = async (): Promise<Intervenant[]> => {
  const now = Date.now();
  
  // Utiliser le cache si valide
  if (intervenantsCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
    return intervenantsCache;
  }
  
  try {
    const response = await apiService.getProjects();
    // API returns { success: true, data: [...] }
    const projects = response?.data || response || [];
    
    console.log('📋 Projets pour intervenants:', projects.length, 'projets');
    
    const intervenantsMap = new Map<string, Intervenant>();
    
    for (const project of projects) {
      // Extraire l'assistance technique
      if (project.assistanceTechnique) {
        const key = `at_${project.assistanceTechnique.toLowerCase().trim()}`;
        const existing = intervenantsMap.get(key);
        if (existing) {
          existing.usageCount++;
        } else {
          intervenantsMap.set(key, {
            id: key,
            nom: project.assistanceTechnique.trim(),
            type: 'assistanceTechnique',
            usageCount: 1,
          });
        }
      }
      
      // Extraire le maître d'oeuvre
      if (project.maitreOeuvre) {
        const key = `mo_${project.maitreOeuvre.toLowerCase().trim()}`;
        const existing = intervenantsMap.get(key);
        if (existing) {
          existing.usageCount++;
        } else {
          intervenantsMap.set(key, {
            id: key,
            nom: project.maitreOeuvre.trim(),
            type: 'maitreOeuvre',
            usageCount: 1,
          });
        }
      }
    }
    
    intervenantsCache = Array.from(intervenantsMap.values());
    lastFetchTime = now;
    console.log(`✅ ${intervenantsCache.length} intervenants extraits des projets`);
    return intervenantsCache;
  } catch (error) {
    console.warn('⚠️ Impossible de récupérer les intervenants:', error);
    return [];
  }
};

/**
 * Rechercher des intervenants par type et nom
 */
export const searchIntervenants = async (
  type: 'assistanceTechnique' | 'maitreOeuvre',
  searchTerm: string
): Promise<Intervenant[]> => {
  const allIntervenants = await fetchIntervenants();
  
  // Filtrer par type
  const filteredByType = allIntervenants.filter(i => i.type === type);
  
  // Si pas de terme de recherche, retourner tous (triés par usage)
  if (!searchTerm || searchTerm.trim() === '') {
    return filteredByType
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);
  }
  
  // Filtrer par nom
  const term = searchTerm.toLowerCase().trim();
  const filtered = filteredByType.filter(i => 
    i.nom.toLowerCase().includes(term)
  );
  
  // Trier: d'abord ceux qui commencent par le terme, puis par usage
  return filtered
    .sort((a, b) => {
      const aStartsWith = a.nom.toLowerCase().startsWith(term) ? 1 : 0;
      const bStartsWith = b.nom.toLowerCase().startsWith(term) ? 1 : 0;
      if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;
      return b.usageCount - a.usageCount;
    })
    .slice(0, 10);
};

/**
 * Vider le cache (forcer le rechargement)
 */
export const clearIntervenantsCache = () => {
  intervenantsCache = [];
  lastFetchTime = 0;
};
