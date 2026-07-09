// Client-side mirror of the core métré engine (apps/core .../metre-calc.domain.ts)
// used ONLY for live preview while the user types measurements. The server
// recomputes every partiel authoritatively (decimal.js) on save — this float
// math is for instant on-screen feedback, never for persisted money.

export type Unite = 'M³' | 'M²' | 'ML' | 'M' | 'KG' | 'T' | 'U' | 'ENS';
export type CalculationType =
  | 'volume'
  | 'surface'
  | 'lineaire'
  | 'poids'
  | 'unite';

export interface UniteConfig {
  type: CalculationType;
  label: string;
  formule: string;
  /** Dimension fields shown for this unité (besides the "Nbre" multiplier). */
  champs: ReadonlyArray<'longueur' | 'largeur' | 'profondeur' | 'nombre' | 'diametre'>;
}

/** Which dimension inputs exist + the formula, per unité. Mirrors the core. */
export const CALCULATION_TYPES_CONFIG: Record<Unite, UniteConfig> = {
  'M³': { type: 'volume', label: 'Volume', formule: 'Longueur × Largeur × Profondeur', champs: ['longueur', 'largeur', 'profondeur'] },
  'M²': { type: 'surface', label: 'Surface', formule: 'Longueur × Largeur', champs: ['longueur', 'largeur'] },
  ML: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  M: { type: 'lineaire', label: 'Linéaire', formule: 'Longueur', champs: ['longueur'] },
  KG: { type: 'poids', label: 'Poids (KG)', formule: 'Nombre × Longueur × Poids/ml', champs: ['nombre', 'longueur', 'diametre'] },
  T: { type: 'poids', label: 'Poids (T)', formule: 'Nombre × Longueur × Poids/ml ÷ 1000', champs: ['nombre', 'longueur', 'diametre'] },
  U: { type: 'unite', label: 'Unité', formule: 'Nombre', champs: ['nombre'] },
  ENS: { type: 'unite', label: 'Ensemble', formule: 'Nombre', champs: ['nombre'] },
};

/** Steel unit weights (kg/ml) by diameter — for ferraillage (KG/T). */
export const POIDS_ACIER: Record<number, number> = {
  6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.208,
  16: 1.578, 20: 2.466, 25: 3.854, 32: 6.313, 40: 9.864,
};
export const DIAMETRES_DISPONIBLES = [6, 8, 10, 12, 14, 16, 20, 25, 32, 40] as const;

export interface MetreLigneInput {
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  /** "Nbre" — number of similar parts (multiplier, default 1). */
  nombreSemblables?: number;
}

const nz = (v: number | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Is this string a métré-computable unité? */
export function isKnownUnite(u: string | undefined): u is Unite {
  return !!u && u in CALCULATION_TYPES_CONFIG;
}

/**
 * Map a raw bordereau unité (often lowercase / ASCII like "m3", "FFT") to a
 * known métré unité. Unknowns fall back to ENS (a plain "nombre" quantity) so
 * the line stays measurable rather than blocked.
 */
export function normalizeUnite(raw: string | undefined): Unite {
  const u = (raw ?? '').trim().toUpperCase().replace(/\./g, '');
  const map: Record<string, Unite> = {
    'M³': 'M³', M3: 'M³', 'M²': 'M²', M2: 'M²',
    ML: 'ML', M: 'M', MÈTRE: 'M', METRE: 'M',
    KG: 'KG', KGS: 'KG', T: 'T', TONNE: 'T', TONNES: 'T',
    U: 'U', UNITE: 'U', UNITÉ: 'U', ENS: 'ENS', ENSEMBLE: 'ENS',
    FORFAIT: 'ENS', FFT: 'ENS', FT: 'ENS', FF: 'ENS',
  };
  return map[u] ?? (isKnownUnite(u) ? u : 'ENS');
}

/** Partiel of one measurement line — display-only float mirror of the core. */
export function calculatePartiel(unite: Unite, l: MetreLigneInput): number {
  const cfg = CALCULATION_TYPES_CONFIG[unite];
  const mult = l.nombreSemblables && l.nombreSemblables > 0 ? l.nombreSemblables : 1;
  let result = 0;
  switch (cfg?.type) {
    case 'volume':
      result = nz(l.longueur) * nz(l.largeur) * nz(l.profondeur);
      break;
    case 'surface':
      result = nz(l.longueur) * nz(l.largeur);
      break;
    case 'lineaire':
      result = nz(l.longueur);
      break;
    case 'poids': {
      const kg = nz(l.nombre) * nz(l.longueur) * (POIDS_ACIER[l.diametre ?? 0] ?? 0);
      result = unite === 'T' ? kg / 1000 : kg;
      break;
    }
    case 'unite':
      result = nz(l.nombre);
      break;
    default:
      result = 0;
  }
  return result * mult;
}

/** 2-dp round for on-screen totals (ROUND_HALF_UP-ish; display only). */
export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
