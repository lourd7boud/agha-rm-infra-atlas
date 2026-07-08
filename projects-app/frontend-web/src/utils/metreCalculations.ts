// Constantes pour les calculs de métré
import { toDecimal, round2, toNumber } from './financeEngine';

export type UniteType = 'M³' | 'ML' | 'M²' | 'KG' | 'T' | 'U' | 'ENS' | 'M';
export type CalculationType = 'volume' | 'surface' | 'lineaire' | 'poids' | 'unite';

export interface MetreCalculation {
  unite: UniteType;
  type: CalculationType;
  formule: string;
  champs: string[];
  description: string;
  label: string;
}

// Configuration des calculs par unité
export const CALCULATION_TYPES_CONFIG: Record<UniteType, MetreCalculation> = {
  'M³': {
    unite: 'M³',
    type: 'volume',
    label: 'Volume',
    formule: 'Longueur × Largeur × Profondeur',
    champs: ['longueur', 'largeur', 'profondeur'],
    description: 'Calcul de volume (terrassement, béton, etc.)'
  },
  'M²': {
    unite: 'M²',
    type: 'surface',
    label: 'Surface',
    formule: 'Longueur × Largeur',
    champs: ['longueur', 'largeur'],
    description: 'Calcul de surface (carrelage, enduit, etc.)'
  },
  'ML': {
    unite: 'ML',
    type: 'lineaire',
    label: 'Linéaire',
    formule: 'Longueur',
    champs: ['longueur'],
    description: 'Métrage linéaire'
  },
  'M': {
    unite: 'M',
    type: 'lineaire',
    label: 'Linéaire',
    formule: 'Longueur',
    champs: ['longueur'],
    description: 'Métrage linéaire'
  },
  'KG': {
    unite: 'KG',
    type: 'poids',
    label: 'Poids (KG)',
    formule: 'Nombre × Longueur × Poids unitaire',
    champs: ['nombre', 'longueur', 'diametre'],
    description: 'Poids en kilogrammes (ferraillage)'
  },
  'T': {
    unite: 'T',
    type: 'poids',
    label: 'Poids (T)',
    formule: 'Nombre × Longueur × Poids unitaire ÷ 1000',
    champs: ['nombre', 'longueur', 'diametre'],
    description: 'Poids en tonnes (ferraillage)'
  },
  'U': {
    unite: 'U',
    type: 'unite',
    label: 'Unité',
    formule: 'Nombre',
    champs: ['nombre'],
    description: 'Nombre d\'unités'
  },
  'ENS': {
    unite: 'ENS',
    type: 'unite',
    label: 'Ensemble',
    formule: 'Nombre',
    champs: ['nombre'],
    description: 'Nombre d\'ensembles'
  }
};

// Helper pour obtenir la config d'un type de calcul
export function getCalculationType(unite: string): MetreCalculation | undefined {
  return CALCULATION_TYPES_CONFIG[unite as UniteType];
}

// Table des poids unitaires du ferraillage (kg/ml)
export const POIDS_ACIER: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  14: 1.208,
  16: 1.578,
  20: 2.466,
  25: 3.854,
  32: 6.313,
  40: 9.864
};

// Diamètres disponibles pour le ferraillage
export const DIAMETRES_DISPONIBLES = [6, 8, 10, 12, 14, 16, 20, 25, 32, 40];

// Fonction pour obtenir le poids unitaire selon le diamètre
export function getPoidsUnitaire(diametre: number): number {
  return POIDS_ACIER[diametre] || 0;
}

// Fonction pour calculer le partiel d'une ligne de métré
// 🔒 Utilise Decimal.js pour éviter les erreurs IEEE 754
export function calculatePartiel(
  unite: UniteType,
  longueur?: number,
  largeur?: number,
  profondeur?: number,
  nombre?: number,
  diametre?: number,
  nombreSemblables?: number // Nombre des parties semblables (multiplicateur)
): number {
  const calcType = CALCULATION_TYPES_CONFIG[unite];
  
  // Le multiplicateur par défaut est 1 si non spécifié
  const multiplier = toDecimal(nombreSemblables && nombreSemblables > 0 ? nombreSemblables : 1);
  
  let result = toDecimal(0);
  
  switch (calcType.type) {
    case 'volume':
      result = toDecimal(longueur || 0).times(toDecimal(largeur || 0)).times(toDecimal(profondeur || 0));
      break;
      
    case 'surface':
      result = toDecimal(longueur || 0).times(toDecimal(largeur || 0));
      break;
      
    case 'lineaire':
      result = toDecimal(longueur || 0);
      break;
      
    case 'poids': {
      const poidsUnitaire = toDecimal(getPoidsUnitaire(diametre || 0));
      const totalKg = toDecimal(nombre || 0).times(toDecimal(longueur || 0)).times(poidsUnitaire);
      result = unite === 'T' ? totalKg.dividedBy(1000) : totalKg;
      break;
    }
      
    case 'unite':
      result = toDecimal(nombre || 0);
      break;
      
    default:
      result = toDecimal(0);
  }
  
  // Multiplier par le nombre de parties semblables
  return toNumber(result.times(multiplier));
}

// Fonction pour formater un nombre avec décimales
export function formatNumber(value: number, decimals: number = 2): string {
  return toNumber(round2(toDecimal(value))).toFixed(decimals);
}

// Fonction pour calculer le pourcentage de réalisation
export function calculatePourcentage(realise: number, prevu: number): number {
  if (prevu === 0) return 0;
  return toNumber(toDecimal(realise).dividedBy(toDecimal(prevu)).times(100));
}
