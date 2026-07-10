// Bons de commande — types client-safe (miroir de /api/bdc) + badges.

export interface BdcArticle {
  numero: number;
  designation: string;
  caracteristiques: string;
  unite: string | null;
  quantite: number | null;
  tvaPct: number | null;
  garanties: string | null;
}

export interface BdcPiece {
  label: string;
  downloadPath: string;
}

export interface BdcAvis {
  id: string;
  portalId: number;
  reference: string;
  objet: string;
  acheteur: string;
  statut: string;
  datePublication: string | null;
  dateLimite: string | null;
  lieu: string | null;
  categorie: string | null;
  naturePrestation: string | null;
  pieces: BdcPiece[];
  articles: BdcArticle[];
  detailFetchedAt: string | null;
  hasReponse: boolean;
  reponseStatut: string | null;
  reponseTotalTtc: number | null;
}

export type PrixSource = 'manuel' | 'catalogue' | 'historique' | 'estimation';

export interface BdcLigne {
  idx: number;
  designation: string;
  unite: string | null;
  quantite: number;
  tvaPct: number;
  prixUnitaireHt: number;
  source: PrixSource;
  sourceRef?: string | null;
  margeAppliquee?: boolean;
  note?: string | null;
  prixVenteHt?: number;
  montantHt?: number;
  montantTva?: number;
  montantTtc?: number;
}

export interface BdcReponse {
  id: string;
  avisId: string;
  statut: string;
  margePct: number;
  lignes: BdcLigne[];
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  notes: string | null;
}

export interface BdcStats {
  total: number;
  enCours: number;
  aVenir: number;
  avecReponse: number;
}

export interface BdcListePayload {
  items: BdcAvis[];
  total: number;
  page: number;
  limit: number;
  stats: BdcStats;
}

export const BDC_STATUT_BADGES: Record<string, { label: string; classes: string }> = {
  en_cours: { label: 'En cours', classes: 'bg-cyan-soft text-cyan' },
  annule: { label: 'Annulé', classes: 'bg-clay-soft text-clay' },
  cloture: { label: 'Clôturé', classes: 'bg-sand text-muted' },
  attribue: { label: 'Attribué', classes: 'bg-emerald-soft text-emerald' },
};

export const REPONSE_STATUT_BADGES: Record<string, { label: string; classes: string }> = {
  brouillon: { label: 'Chiffrage en cours', classes: 'bg-ochre-soft text-ochre' },
  prete: { label: 'Prête à déposer', classes: 'bg-cyan-soft text-cyan' },
  deposee: { label: 'Déposée', classes: 'bg-emerald-soft text-emerald' },
  gagnee: { label: 'Gagnée 🏆', classes: 'bg-emerald-soft text-emerald' },
  perdue: { label: 'Perdue', classes: 'bg-sand text-muted' },
};

export const SOURCE_LABELS: Record<PrixSource, string> = {
  manuel: 'Manuel',
  catalogue: 'Catalogue',
  historique: 'Historique',
  estimation: 'Estimation',
};

/** Jours restants avant la date limite (négatif = dépassée). */
export function joursRestants(dateLimite: string | null): number | null {
  if (!dateLimite) return null;
  const diff = new Date(dateLimite).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export const PORTAL_BDC_BASE = 'https://www.marchespublics.gov.ma';
