// Radar proactif (Niveau 4) — types client-safe (miroir de /api/radar) +
// helpers visuels. Le core score les marchés en cours; ici on les affiche.

export interface RadarCandidate {
  id: string;
  tenderId: string;
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
  statut: string;
  scoredAt: string;
  reference: string;
  objet: string;
  buyerName: string;
  category: string | null;
  region: string | null;
  ville: string | null;
  location: string | null;
  deadlineAt: string;
  estimationMad: number | null;
  sourceUrl: string | null;
}

export interface RadarStats {
  total: number;
  nouveaux: number;
  poursuivis: number;
  ecartes: number;
  scoreMoyen: number;
  scoreMax: number;
}

export interface RadarCandidatesPayload {
  items: RadarCandidate[];
  total: number;
  page: number;
  limit: number;
  stats: RadarStats;
}

export const RADAR_STATUT_BADGES: Record<string, { label: string; classes: string }> = {
  nouveau: { label: 'Nouveau', classes: 'bg-cyan-soft text-cyan' },
  vu: { label: 'Vu', classes: 'bg-sand text-muted' },
  poursuivi: { label: 'À poursuivre', classes: 'bg-emerald-soft text-emerald' },
  ecarte: { label: 'Écarté', classes: 'bg-clay-soft text-clay' },
};

// Ordre + libellés des dimensions du score (mêmes clés que le domaine core).
export const RADAR_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: 'categorie', label: 'Cœur de métier' },
  { key: 'proximite', label: 'Proximité' },
  { key: 'delai', label: 'Délai' },
  { key: 'taille', label: 'Taille marché' },
  { key: 'concurrence', label: 'Concurrence' },
  { key: 'fraicheur', label: 'Fraîcheur' },
];

/** Couleur du score selon sa force (0-100). */
export function scoreColor(score: number): { ring: string; text: string; bg: string } {
  if (score >= 75) return { ring: 'border-emerald', text: 'text-emerald', bg: 'bg-emerald-soft' };
  if (score >= 55) return { ring: 'border-cyan', text: 'text-cyan', bg: 'bg-cyan-soft' };
  if (score >= 40) return { ring: 'border-ochre', text: 'text-ochre', bg: 'bg-ochre-soft' };
  return { ring: 'border-line', text: 'text-muted', bg: 'bg-sand' };
}

/** Jours restants avant l'échéance (négatif = dépassée). */
export function joursRestants(deadlineAt: string | null): number | null {
  if (!deadlineAt) return null;
  return Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 86_400_000);
}
