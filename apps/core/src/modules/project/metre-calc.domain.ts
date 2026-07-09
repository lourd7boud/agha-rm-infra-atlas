// Métré calculation engine — ported verbatim from the BTP app's
// `metreCalculations.ts`. The métré is the ONLY place quantities are entered:
// per bordereau line, per période, the user types measurement lignes and the
// `partiel` of each is derived by a unit-aware geometry formula. Décompte and
// attachement quantities are cumulative sums of these partiels — never typed.
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toDec(v: number | string | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(0);
  }
}
const round2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export type Unite = 'M³' | 'M²' | 'ML' | 'M' | 'KG' | 'T' | 'U' | 'ENS';
export type CalculationType = 'volume' | 'surface' | 'lineaire' | 'poids' | 'unite';

export interface UniteConfig {
  type: CalculationType;
  label: string;
  formule: string;
  champs: string[];
}

/** Which dimension inputs exist + the formula, per unité. */
export const CALCULATION_TYPES_CONFIG: Record<Unite, UniteConfig> = {
  'M³': { type: 'volume', label: 'Volume', formule: 'Longueur × Largeur × Profondeur', champs: ['longueur', 'largeur', 'profondeur'] },
  'M²': { type: 'surface', label: 'Surface', formule: 'Longueur × Largeur', champs: ['longueur', 'largeur'] },
  ML: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  M: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  KG: { type: 'poids', label: 'Poids (KG)', formule: 'Nombre × Longueur × Poids unitaire', champs: ['nombre', 'longueur', 'diametre'] },
  T: { type: 'poids', label: 'Poids (T)', formule: 'Nombre × Longueur × Poids unitaire ÷ 1000', champs: ['nombre', 'longueur', 'diametre'] },
  U: { type: 'unite', label: 'Unité', formule: 'Nombre', champs: ['nombre'] },
  ENS: { type: 'unite', label: 'Ensemble', formule: 'Nombre', champs: ['nombre'] },
};

/** Steel unit weights (kg/ml) by diameter — for ferraillage (KG/T). */
export const POIDS_ACIER: Record<number, number> = {
  6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.208,
  16: 1.578, 20: 2.466, 25: 3.854, 32: 6.313, 40: 9.864,
};
export const DIAMETRES_DISPONIBLES = [6, 8, 10, 12, 14, 16, 20, 25, 32, 40];

export function getPoidsUnitaire(diametre: number): number {
  return POIDS_ACIER[diametre] ?? 0;
}

export interface MetreLigneInput {
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  /** "Nbre" — number of similar parts (multiplier, default 1). */
  nombreSemblables?: number;
}

/**
 * Partiel of one métré line — full Decimal precision, NO rounding inside
 * (matches the reference; rounding happens only at the totals).
 */
export function calculatePartiel(unite: Unite, l: MetreLigneInput): number {
  const cfg = CALCULATION_TYPES_CONFIG[unite];
  const multiplier = toDec(
    l.nombreSemblables && l.nombreSemblables > 0 ? l.nombreSemblables : 1,
  );
  let result = new Decimal(0);
  switch (cfg?.type) {
    case 'volume':
      result = toDec(l.longueur).times(toDec(l.largeur)).times(toDec(l.profondeur));
      break;
    case 'surface':
      result = toDec(l.longueur).times(toDec(l.largeur));
      break;
    case 'lineaire':
      result = toDec(l.longueur);
      break;
    case 'poids': {
      const totalKg = toDec(l.nombre)
        .times(toDec(l.longueur))
        .times(toDec(getPoidsUnitaire(l.diametre ?? 0)));
      result = unite === 'T' ? totalKg.dividedBy(1000) : totalKg;
      break;
    }
    case 'unite':
      result = toDec(l.nombre);
      break;
    default:
      result = new Decimal(0);
  }
  return result.times(multiplier).toNumber();
}

export interface MetreTotals {
  /** Σ partiels of the current-période lignes, ROUND_HALF_UP 2dp. */
  totalPartiel: number;
  /** cumulPrecedent + totalPartiel, ROUND_HALF_UP 2dp. */
  totalCumule: number;
  /** totalCumule / quantitéBordereau × 100, clamped ±999.99. */
  pourcentage: number;
}

/**
 * Métré totals for one bordereau line in one période. `partiels` are the
 * current-période line partiels; `cumulPrecedent` is Σ totalPartiel of earlier
 * périodes for the same bordereau line.
 */
export function computeMetreTotals(
  partiels: readonly number[],
  cumulPrecedent: number,
  quantiteBordereau: number,
): MetreTotals {
  const totalPartielD = round2(
    partiels.reduce((acc, p) => acc.plus(toDec(p)), new Decimal(0)),
  );
  const totalCumuleD = round2(toDec(cumulPrecedent).plus(totalPartielD));
  const raw =
    quantiteBordereau > 0
      ? totalCumuleD.dividedBy(toDec(quantiteBordereau)).times(100).toNumber()
      : 0;
  const pourcentage = Math.max(-999.99, Math.min(999.99, raw));
  return {
    totalPartiel: totalPartielD.toNumber(),
    totalCumule: totalCumuleD.toNumber(),
    pourcentage,
  };
}
