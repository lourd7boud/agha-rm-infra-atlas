/**
 * Agent AGHA-RM-INFRA — web mirrors of the core /expert response shapes.
 * Dates arrive as ISO strings over HTTP; money as numbers (MAD).
 */

export interface CountEntry {
  key: string;
  count: number;
}

export interface RebateDistribution {
  count: number;
  medianPct: number;
  p25Pct: number;
  p75Pct: number;
  meanPct: number;
}

export interface ExpertKnowledge {
  generatedAt: string;
  marche: {
    tendersTotal: number;
    tendersActive: number;
    buyersTotal: number;
    withBudget: number;
    withCaution: number;
    withBpu: number;
    categories: CountEntry[];
    topSegments: CountEntry[];
  };
  concurrence: {
    resultsObserved: number;
    tendersWithResults: number;
    avgBiddersPerTender: number | null;
    byBuyer: Array<{ buyerName: string; tendersObserved: number; avgBidders: number }>;
    topCompetitors: Array<{
      name: string;
      participations: number;
      wins: number;
      totalWonMad: number;
    }>;
  };
  rabais: {
    sampled: number;
    rejected: number;
    overall: RebateDistribution | null;
    topBuyers: Array<RebateDistribution & { buyerName: string }>;
    topSegments: Array<RebateDistribution & { segment: string }>;
  };
  topAcheteurs: Array<{
    buyerName: string;
    region: string;
    tenderCount: number;
    activeCount: number;
    avgEstimationMad: number | null;
    topSegments: string[];
  }>;
}

export interface PricingScenario {
  nom: 'prudent' | 'equilibre' | 'agressif';
  rabaisPct: number;
  prixMad: number;
  margeMad: number;
  margePct: number;
  probabiliteGain: number;
  esperanceMad: number;
  statutReglementaire: 'conforme' | 'proche_seuil_bas';
  commentaire: string;
}

export interface ExpertAnalysis {
  tenderId: string;
  reference: string;
  buyerName: string;
  objet: string;
  segment: string;
  generatedAt: string;
  estimationMad: number | null;
  competition: {
    concurrentsAttendus: number;
    base: 'acheteur' | 'marche' | 'hypothese';
    detail: string;
  };
  rabais: {
    recommandePct: number | null;
    fourchette: { minPct: number; maxPct: number } | null;
    source: string;
  };
  scenarios: {
    estimationMad: number;
    hypotheses: {
      costRatio: number;
      concurrentsConnus: number;
      seuilAnormalementBasPct: number;
      methode: string;
    };
    scenarios: PricingScenario[];
    recommandation: { nom: string; raison: string };
  } | null;
  benchmark: {
    source: 'buyer' | 'segment' | 'overall';
    key: string;
    count: number;
    medianPct: number;
    p25Pct: number;
    p75Pct: number;
  } | null;
  avisExpert: {
    synthese: string;
    atouts: string[];
    risques: string[];
    pointsVigilance: string[];
    goNoGo: {
      verdict: 'go' | 'no_go' | 'a_verifier';
      confiancePct: number;
      raisons: string[];
    };
    model: string;
  } | null;
  avertissements: string[];
}

export interface BpuPricedLine {
  section: string | null;
  designation: string;
  quantite: number;
  unite: string | null;
  prixUnitaireMad: number;
  montantMad: number;
}

/** Where each unit price came from — the transparency behind the proposal. */
export interface PricingBasis {
  dce: number;
  historique: number;
  ia: number;
  aucune: number;
}

export interface BpuProposal {
  lines: BpuPricedLine[];
  totalMad: number;
  estimationMad: number | null;
  rabaisPct: number | null;
  targetTotalMad: number | null;
  methode: 'calibre_estimation' | 'prix_ia_non_calibres' | 'repartition_uniforme';
  avertissements: string[];
  generatedAt: string;
  model: string | null;
  /** Absent on proposals generated before the reference-pricing engine landed. */
  pricingBasis?: PricingBasis;
}

export type PieceStatut =
  | 'disponible'
  | 'a_fournir'
  | 'expire'
  | 'a_generer'
  | 'a_etablir';

export interface DossierPiece {
  code: string;
  label: string;
  volet: 'administratif' | 'technique' | 'financier';
  statut: PieceStatut;
  note?: string;
}

export interface AdminFinancialDossier {
  reference: string;
  buyerName: string;
  objet: string;
  generatedAt: string;
  readinessScore: number;
  ready: boolean;
  pieces: DossierPiece[];
  cautionProvisoireMad: number | null;
  qualificationsRequises: Array<{
    secteur?: string | null;
    qualification?: string | null;
    classe?: string | null;
  }>;
  chiffreAffairesMinMad: number | null;
  delaiExecutionMois: number | null;
  acteEngagement: {
    montantMad: number | null;
    montantEnLettres: string | null;
  };
}

export const METHODE_LABELS: Record<BpuProposal['methode'], string> = {
  calibre_estimation: 'Calibré sur le montant cible',
  prix_ia_non_calibres: 'Prix IA non calibrés',
  repartition_uniforme: 'Répartition uniforme',
};

export const STATUT_LABELS: Record<PieceStatut, string> = {
  disponible: 'Disponible',
  a_fournir: 'À fournir',
  expire: 'Expiré',
  a_generer: 'À générer',
  a_etablir: 'À établir',
};

export const STATUT_TONES: Record<PieceStatut, string> = {
  disponible: 'bg-emerald-soft text-emerald',
  a_fournir: 'bg-clay-soft text-clay',
  expire: 'bg-clay-soft text-clay',
  a_generer: 'bg-cyan-soft text-cyan',
  a_etablir: 'bg-ochre-soft text-ochre-deep',
};

const csvEscape = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** Excel-friendly CSV (UTF-8 BOM + semicolons) of the priced bordereau. */
export function bpuToCsv(proposal: BpuProposal): string {
  const header = ['Section', 'Désignation', 'Quantité', 'Unité', 'PU (MAD)', 'Montant (MAD)'];
  const rows = proposal.lines.map((line) =>
    [
      csvEscape(line.section ?? ''),
      csvEscape(line.designation),
      String(line.quantite),
      csvEscape(line.unite ?? ''),
      line.prixUnitaireMad.toFixed(2),
      line.montantMad.toFixed(2),
    ].join(';'),
  );
  const total = ['', csvEscape('TOTAL'), '', '', '', proposal.totalMad.toFixed(2)].join(';');
  return `﻿${header.join(';')}\n${rows.join('\n')}\n${total}`;
}
