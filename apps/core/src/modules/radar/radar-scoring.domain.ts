// Radar proactif — moteur de scoring PUR (zéro I/O). À partir d'un appel
// d'offres et du profil de la société, calcule un score d'opportunité 0-100
// avec une ventilation par dimension et des raisons lisibles. C'est le cœur
// du Niveau 4: transformer un catalogue de dizaines de milliers d'avis en une
// courte liste « à traiter en priorité ».
//
// Chaque dimension rend un score 0..1; le total est une somme pondérée
// renormalisée sur les dimensions PRÉSENTES (la « concurrence » est optionnelle
// — absente quand on n'a pas d'historique sur l'acheteur).

// ── Profil de la société (AGHA RM INFRA — Boudnib, Drâa-Tafilalet) ───────────
export interface RadarProfile {
  /** Poids de fit par catégorie de marché (label FR du portail). */
  categoryWeights: Record<string, number>;
  /** Région d'attache — proximité maximale. */
  homeRegion: string;
  /** Mots-clés du lieu d'attache (ville/province) — proximité maximale. */
  homeVilleKeywords: string[];
  /** Régions limitrophes — proximité moyenne. */
  neighboringRegions: string[];
  /** Fourchette d'estimation confortable (MAD). */
  estimationConfort: { min: number; max: number };
  /** Délai minimal jugé faisable pour préparer une offre (jours). */
  delaiMinJours: number;
}

export const AGHA_RADAR_PROFILE: RadarProfile = {
  categoryWeights: {
    Travaux: 1.0, // cœur de métier: BTP, constructions, travaux divers
    Fournitures: 0.6, // négoce (activité déclarée)
    Services: 0.3,
  },
  homeRegion: 'Drâa-Tafilalet',
  homeVilleKeywords: [
    'boudnib',
    'errachidia',
    'rachidia',
    'tafilalet',
    'goulmima',
    'rich',
    'midelt',
  ],
  neighboringRegions: [
    'Souss-Massa',
    'Oriental',
    'Fès-Meknès',
    'Béni Mellal-Khénifra',
    'Marrakech-Safi',
  ],
  estimationConfort: { min: 50_000, max: 3_000_000 },
  delaiMinJours: 3,
};

// ── Entrée: un avis à scorer + signaux optionnels ────────────────────────────
export interface RadarTenderInput {
  category: string | null;
  region: string | null;
  ville: string | null;
  location: string | null;
  /** Échéance de remise des plis. */
  deadlineAt: Date;
  estimationMad: number | null;
  /** Date de publication / première détection. */
  createdAt: Date;
  /** Intelligence acheteur (optionnelle): concurrence moyenne observée. */
  buyerIntel?: { nbDevisMoyen: number | null; tauxInfructueux: number | null } | null;
}

export type RadarDimension =
  | 'categorie'
  | 'proximite'
  | 'delai'
  | 'taille'
  | 'concurrence'
  | 'fraicheur';

export interface RadarScore {
  /** Score global 0-100 (entier). */
  score: number;
  /** Ventilation par dimension présente (0..1). */
  breakdown: Partial<Record<RadarDimension, number>>;
  /** Raisons lisibles, meilleures d'abord + drapeaux rouges. */
  reasons: string[];
  /** true quand la date limite est déjà passée (score forcé à 0). */
  expire: boolean;
}

// Poids relatifs des dimensions (renormalisés sur les présentes).
const WEIGHTS: Record<RadarDimension, number> = {
  categorie: 0.28,
  proximite: 0.24,
  delai: 0.14,
  taille: 0.14,
  concurrence: 0.12,
  fraicheur: 0.08,
};

const DAY_MS = 86_400_000;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function scoreCategorie(profile: RadarProfile, category: string | null): number {
  if (!category) return 0.4;
  const weight = profile.categoryWeights[category];
  return weight ?? 0.4;
}

function scoreProximite(
  profile: RadarProfile,
  region: string | null,
  ville: string | null,
  location: string | null,
): number {
  const hay = `${normalize(ville)} ${normalize(location)}`;
  if (profile.homeVilleKeywords.some((kw) => hay.includes(kw))) return 1;
  const reg = normalize(region);
  if (reg && reg === normalize(profile.homeRegion)) return 0.9;
  if (profile.neighboringRegions.some((r) => normalize(r) === reg)) return 0.55;
  if (!reg || reg.includes('non localise')) return 0.4;
  return 0.25;
}

function scoreDelai(profile: RadarProfile, deadlineAt: Date, now: Date): number {
  const jours = (deadlineAt.getTime() - now.getTime()) / DAY_MS;
  if (jours <= 0) return 0;
  if (jours < profile.delaiMinJours) return 0.2;
  if (jours < 7) return 0.6;
  if (jours <= 45) return 1;
  return 0.75; // très loin: faisable mais pas urgent
}

function scoreTaille(profile: RadarProfile, estimationMad: number | null): number {
  if (estimationMad == null || estimationMad <= 0) return 0.5;
  const { min, max } = profile.estimationConfort;
  if (estimationMad >= min && estimationMad <= max) return 1;
  if (estimationMad < min) return 0.6; // petit chantier, faisable
  if (estimationMad <= max * 3.5) return 0.5; // étirement
  return 0.2; // trop gros pour une jeune société
}

function scoreConcurrence(intel: RadarTenderInput['buyerIntel']): number | null {
  if (!intel || intel.nbDevisMoyen == null) return null;
  // Moins de concurrents = mieux. 3 devis → ~1.0, 15+ → ~0.3.
  const base = clamp01(1 - (intel.nbDevisMoyen - 3) / 12);
  // Bonus si l'acheteur déclare souvent infructueux (offre conforme = chance).
  const bonus = intel.tauxInfructueux != null ? 0.15 * clamp01(intel.tauxInfructueux) : 0;
  return clamp01(0.3 + 0.7 * base + bonus);
}

function scoreFraicheur(createdAt: Date, now: Date): number {
  const jours = (now.getTime() - createdAt.getTime()) / DAY_MS;
  if (jours <= 2) return 1;
  if (jours <= 7) return 0.7;
  if (jours <= 14) return 0.5;
  return 0.3;
}

const DIM_LABEL: Record<RadarDimension, string> = {
  categorie: 'Cœur de métier',
  proximite: 'Proximité géographique',
  delai: 'Délai de préparation',
  taille: 'Taille du marché',
  concurrence: 'Concurrence',
  fraicheur: 'Fraîcheur',
};

/**
 * Score une opportunité. `now` injecté pour des tests déterministes.
 */
export function scoreTender(
  profile: RadarProfile,
  input: RadarTenderInput,
  now: Date,
): RadarScore {
  const expire = input.deadlineAt.getTime() <= now.getTime();
  const dims: Partial<Record<RadarDimension, number>> = {
    categorie: clamp01(scoreCategorie(profile, input.category)),
    proximite: clamp01(scoreProximite(profile, input.region, input.ville, input.location)),
    delai: clamp01(scoreDelai(profile, input.deadlineAt, now)),
    taille: clamp01(scoreTaille(profile, input.estimationMad)),
    fraicheur: clamp01(scoreFraicheur(input.createdAt, now)),
  };
  const conc = scoreConcurrence(input.buyerIntel);
  if (conc != null) dims.concurrence = clamp01(conc);

  // Somme pondérée renormalisée sur les dimensions présentes.
  let weighted = 0;
  let totalWeight = 0;
  for (const key of Object.keys(dims) as RadarDimension[]) {
    weighted += (dims[key] as number) * WEIGHTS[key];
    totalWeight += WEIGHTS[key];
  }
  const raw = totalWeight > 0 ? weighted / totalWeight : 0;
  const score = expire ? 0 : Math.round(raw * 100);

  // Raisons: dimensions fortes (≥0.7) puis drapeaux faibles (≤0.3).
  const entries = (Object.keys(dims) as RadarDimension[])
    .map((key) => ({ key, val: dims[key] as number }))
    .sort((a, b) => b.val - a.val);
  const reasons: string[] = [];
  if (expire) reasons.push('⛔ Date limite dépassée');
  for (const { key, val } of entries) {
    if (val >= 0.7) reasons.push(`✓ ${DIM_LABEL[key]}`);
  }
  for (const { key, val } of entries) {
    if (val <= 0.3) reasons.push(`⚠ ${DIM_LABEL[key]} faible`);
  }

  return { score, breakdown: dims, reasons, expire };
}
