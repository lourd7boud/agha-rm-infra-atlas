// Métré engine — faithful port of the source app's metreCalculations.ts plus
// the MetrePage totals semantics (nombreSemblables multiplier on every ligne,
// sous-section nombreElements multiplier on poids lignes, totals rounded
// half-up 2dp for storage).
import { Decimal, round2, toDecimal, toNumber } from './btp-finance.domain';

export type CalculationType = 'volume' | 'surface' | 'lineaire' | 'poids' | 'unite';

export interface UniteConfig {
  type: CalculationType;
  label: string;
  formule: string;
  champs: string[];
}

/** Bordereau units (the source app's dropdown) → computation behaviour. */
export const UNITE_CONFIG: Record<string, UniteConfig> = {
  'M³': {
    type: 'volume',
    label: 'Volume',
    formule: 'Longueur × Largeur × Profondeur',
    champs: ['longueur', 'largeur', 'profondeur'],
  },
  'M²': {
    type: 'surface',
    label: 'Surface',
    formule: 'Longueur × Largeur',
    champs: ['longueur', 'largeur'],
  },
  ML: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  M: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  KG: {
    type: 'poids',
    label: 'Poids (KG)',
    formule: 'Nombre × Longueur × Poids unitaire',
    champs: ['nombre', 'longueur', 'diametre'],
  },
  T: {
    type: 'poids',
    label: 'Poids (T)',
    formule: 'Nombre × Longueur × Poids unitaire ÷ 1000',
    champs: ['nombre', 'longueur', 'diametre'],
  },
  U: { type: 'unite', label: 'Unité', formule: 'Nombre', champs: ['nombre'] },
  ENS: { type: 'unite', label: 'Ensemble', formule: 'Nombre', champs: ['nombre'] },
};

/** Rebar unit weights (kg/ml) by diameter — verbatim from the source app. */
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
  40: 9.864,
};

export const DIAMETRES_DISPONIBLES = [6, 8, 10, 12, 14, 16, 20, 25, 32, 40];

const UNITE_FALLBACK: UniteConfig = {
  type: 'unite',
  label: 'Unité',
  formule: 'Nombre',
  champs: ['nombre'],
};

/** Tolerant lookup: "m3"/"M3" → M³, "m2" → M², unknown → unité (Nombre). */
export function resolveUniteConfig(unite: string | null | undefined): UniteConfig {
  const raw = (unite ?? '').trim().toUpperCase();
  const normalised = raw.replace('3', '³').replace('2', '²');
  return UNITE_CONFIG[normalised] ?? UNITE_CONFIG[raw] ?? UNITE_FALLBACK;
}

export interface MetreSection {
  id: string;
  titre: string;
  ordre?: number;
  couleur?: string;
}

export interface MetreSousSection {
  id: string;
  sectionId?: string;
  titre: string;
  ordre?: number;
  /** Multiplier (nb of identical elements) applied on poids lignes. */
  nombreElements?: number;
}

export interface MetreLigne {
  id: string;
  sectionId?: string;
  subSectionId?: string;
  numero?: number;
  designation?: string;
  nombreSemblables?: number;
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  /** Computed (or manually entered when no dimensions are given). */
  partiel?: number;
  observations?: string;
}

/**
 * Partiel of one measurement line for a given unité — full precision, source
 * formulas per unit type, × nombreSemblables.
 */
export function computeLignePartiel(unite: string, ligne: MetreLigne): number {
  const config = resolveUniteConfig(unite);
  const multiplier = toDecimal(
    ligne.nombreSemblables && ligne.nombreSemblables > 0 ? ligne.nombreSemblables : 1,
  );

  const hasDimensionInput =
    ligne.longueur != null ||
    ligne.largeur != null ||
    ligne.profondeur != null ||
    ligne.nombre != null ||
    ligne.diametre != null;
  // Manual entry passthrough: legacy rows sometimes carry only a partiel.
  if (!hasDimensionInput) return ligne.partiel ?? 0;

  let result = new Decimal(0);
  switch (config.type) {
    case 'volume':
      result = toDecimal(ligne.longueur)
        .times(toDecimal(ligne.largeur))
        .times(toDecimal(ligne.profondeur));
      break;
    case 'surface':
      result = toDecimal(ligne.longueur).times(toDecimal(ligne.largeur));
      break;
    case 'lineaire':
      result = toDecimal(ligne.longueur);
      break;
    case 'poids': {
      const poidsUnitaire = toDecimal(POIDS_ACIER[ligne.diametre ?? 0] ?? 0);
      const totalKg = toDecimal(ligne.nombre).times(toDecimal(ligne.longueur)).times(poidsUnitaire);
      result = config === UNITE_CONFIG.T ? totalKg.dividedBy(1000) : totalKg;
      break;
    }
    case 'unite':
      result = toDecimal(ligne.nombre);
      break;
  }
  return toNumber(result.times(multiplier));
}

export interface MetreTotals {
  /** Lignes with recomputed partiels (nombreElements applied on poids). */
  lignes: MetreLigne[];
  /** Σ partiels, stored ROUND_HALF_UP 2dp (source-app storage rule). */
  totalPartiel: number;
}

/**
 * Recomputes every ligne's partiel server-side (the client mirrors this live)
 * and the stored total. On poids lignes the owning sous-section's
 * nombreElements multiplies the base partiel — MetrePage behaviour.
 */
export function computeMetreTotals(
  unite: string,
  sousSections: MetreSousSection[],
  lignes: MetreLigne[],
): MetreTotals {
  const config = resolveUniteConfig(unite);
  const bySousSection = new Map(sousSections.map((s) => [s.id, s]));
  let total = new Decimal(0);
  const recomputed = lignes.map((ligne) => {
    let partiel = computeLignePartiel(unite, ligne);
    if (config.type === 'poids' && ligne.subSectionId) {
      const nombreElements = bySousSection.get(ligne.subSectionId)?.nombreElements;
      if (nombreElements && nombreElements > 0 && nombreElements !== 1) {
        partiel = toNumber(toDecimal(partiel).times(nombreElements));
      }
    }
    total = total.plus(toDecimal(partiel));
    return { ...ligne, partiel };
  });
  return { lignes: recomputed, totalPartiel: toNumber(round2(total)) };
}

/** % réalisation of a bordereau line (cumulé ÷ quantité bordereau × 100). */
export function computePourcentageRealisation(cumule: number, quantiteBordereau: number): number {
  if (!quantiteBordereau) return 0;
  return toNumber(
    toDecimal(cumule).dividedBy(toDecimal(quantiteBordereau)).times(100).toDecimalPlaces(2),
  );
}
