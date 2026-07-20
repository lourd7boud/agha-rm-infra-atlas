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

export type PrixSource = 'manuel' | 'catalogue' | 'historique' | 'estimation' | 'agent';

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
  agent: 'Agent IA',
};

export type PricingRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PricingStage =
  | 'analyse'
  | 'recherche_interne'
  | 'recherche_marche'
  | 'normalisation'
  | 'estimation'
  | 'optimisation'
  | 'brouillon_enregistre';

export interface LinePricingDecision {
  idx: number;
  estimatedCostHt: number;
  proposedUnitPriceHt: number;
  rangeLowHt: number;
  rangeHighHt: number;
  markupPct: number;
  confidence: 'elevee' | 'moyenne' | 'faible';
  method: 'reference_directe' | 'marche_pondere' | 'decomposition' | 'ia_conservative';
  sourceIds: string[];
  explanation: string;
  warnings: string[];
  manualPriceLocked: boolean;
}

export interface PricingEvidenceSummary {
  id: string;
  designation: string;
  sourceType: 'bpu' | 'devis' | 'bdc' | 'fournisseur' | 'facture' | 'web' | 'resultat';
  sourceRef: string;
  sourceUrl: string | null;
  observedAt: string;
  unit: string;
  unitPriceHtMad: number;
  verified: boolean;
  reliability: number;
}

export interface PricingRunView {
  id: string;
  avisId: string;
  status: PricingRunStatus;
  stage: PricingStage;
  progressPct: number;
  requestedMarkupPct: number;
  calibrationVersion: string;
  decisions: LinePricingDecision[];
  evidence: PricingEvidenceSummary[];
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Résultats & intelligence concurrents ────────────────────────────────────
export interface BdcResultat {
  id: string;
  reference: string;
  objet: string;
  acheteur: string;
  dateResultat: string | null;
  nbDevis: number | null;
  issue: string;
  attributaire: string | null;
  montantTtc: number | null;
  avisId: string | null;
}

export interface BdcResultatStats {
  total: number;
  attribues: number;
  infructueux: number;
  montantTotal: number;
  acheteurs: number;
  attributaires: number;
}

export interface BdcResultatsPayload {
  items: BdcResultat[];
  total: number;
  page: number;
  limit: number;
  stats: BdcResultatStats;
}

export interface BdcIntelligence {
  acheteur: string;
  nbResultats: number;
  nbAttribues: number;
  nbInfructueux: number;
  devisMoyens: number | null;
  montantMedian: number | null;
  montantMin: number | null;
  montantMax: number | null;
  topAttributaires: Array<{ nom: string; victoires: number; montantTotal: number }>;
  derniers: BdcResultat[];
}

export const ISSUE_BADGES: Record<string, { label: string; classes: string }> = {
  attribue: { label: 'Attribué', classes: 'bg-emerald-soft text-emerald' },
  infructueux: { label: 'Infructueux', classes: 'bg-clay-soft text-clay' },
};

export interface BdcProposerResume {
  proposees: number;
  catalogue: number;
  historique: number;
  restantes: number;
  candidatsInternes: number;
  candidatsCatalogue: number;
}

/** Jours restants avant la date limite (négatif = dépassée). */
export function joursRestants(dateLimite: string | null): number | null {
  if (!dateLimite) return null;
  const diff = new Date(dateLimite).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export const PORTAL_BDC_BASE = 'https://www.marchespublics.gov.ma';
