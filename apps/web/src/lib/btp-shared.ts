// Module Projets BTP — client-safe layer: API record types, status badge maps,
// formatters and the métré live-calculation mirror (the server engine in
// apps/core/src/modules/project/btp-metre.domain.ts is the source of truth;
// this mirror only powers instant grid feedback while typing).

// ─── Records (mirror of /api/btp responses) ──────────────────────────────────

export interface ArretTravaux {
  id?: string;
  dateArret: string;
  dateReprise?: string | null;
  motif?: string | null;
}

export interface DelaiInfo {
  delaiJours: number;
  joursArret: number;
  delaiTotal: number;
  dateFinInitiale: string | null;
  dateFinEffective: string | null;
  joursEcoules: number;
  joursRestants: number;
  pourcentage: number;
  status: 'completed' | 'overdue' | 'critical' | 'warning' | 'normal' | 'unknown';
  enArret: boolean;
}

export interface BtpProject {
  id: string;
  reference: string;
  name: string;
  buyerName: string;
  montantMarcheMad: number;
  ordreServiceDate: string | null;
  delaiMois: number | null;
  status: string;
  objet: string | null;
  annee: string | null;
  societe: string | null;
  commune: string | null;
  typeMarche: string | null;
  modePassation: string | null;
  dateOuverture: string | null;
  receptionProvisoire: string | null;
  receptionDefinitive: string | null;
  achevementTravaux: string | null;
  assistanceTechnique: string | null;
  maitreOeuvre: string | null;
  progressPct: number;
  rc: string | null;
  cb: string | null;
  cnss: string | null;
  patente: string | null;
  programme: string | null;
  projetLibelle: string | null;
  ligneBudgetaire: string | null;
  chapitre: string | null;
  arrets: ArretTravaux[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BtpPortfolio {
  items: BtpProject[];
  total: number;
  stats: {
    total: number;
    actifs: number;
    termines: number;
    brouillons: number;
    montantTotalMad: number;
  };
  facets: { annees: string[]; assistanceTechnique: string[]; maitreOeuvre: string[] };
}

export interface BtpProjectDetail extends BtpProject {
  delai: DelaiInfo;
  counts: {
    bordereauLignes: number;
    periodes: number;
    decomptes: number;
    photos: number;
    pv: number;
    documents: number;
  };
  dernierDecompte: {
    id: string;
    numero: number;
    totalTtcMad: number;
    montantAcompteMad: number;
    statut: string;
  } | null;
  situationContractuelle: {
    montantInitial: number;
    totalAvenants: number;
    montantActuel: number;
    delaiInitialMois: number;
    delaiSupplementaireMois: number;
    count: number;
    approuves: number;
  };
}

export interface BordereauLigne {
  id: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

export interface Bordereau {
  id?: string;
  projectId: string;
  reference?: string | null;
  designation?: string | null;
  lignes: BordereauLigne[];
  montantTotalMad?: number;
}

export interface Periode {
  id: string;
  projectId: string;
  numero: number;
  libelle: string | null;
  dateDebut: string | null;
  dateFin: string | null;
  tauxTva: number;
  tauxRetenue: number;
  isDecompteDernier: boolean;
  statut: string;
  observations: string | null;
  metresCount?: number;
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
  partiel?: number;
  observations?: string;
}

export interface Metre {
  id: string;
  projectId: string;
  periodeId: string;
  bordereauLigneId: string;
  designationBordereau: string | null;
  unite: string | null;
  sections: MetreSection[];
  sousSections: MetreSousSection[];
  lignes: MetreLigne[];
  totalPartiel: number;
  totalCumule: number;
  quantiteBordereau: number;
  pourcentageRealisation: number;
}

export interface MetreContext {
  periode: Periode;
  bordereau: Bordereau | null;
  metres: Metre[];
  previousByLigne: Record<
    string,
    { periodeNumero: number; totalPartiel: number; lignes: MetreLigne[] }[]
  >;
}

export interface DecompteLigne {
  prixNo: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  quantiteRealisee: number;
  prixUnitaireHT: number;
  montantHT: number;
  bordereauLigneId: string;
}

export interface Decompte {
  id: string;
  projectId: string;
  periodeId: string | null;
  numero: number;
  dateDecompte: string | null;
  lignes: DecompteLigne[];
  tauxTva: number;
  totalHtMad: number;
  revisionMontantMad: number;
  montantTvaMad: number;
  totalTtcMad: number;
  depensesAnterieuresMad: number;
  decomptesPrecedentsMad: number;
  retenueGarantieMad: number;
  montantAcompteMad: number;
  isDernier: boolean;
  statut: string;
  periodeLibelle?: string | null;
  periode?: Periode | null;
  revision?: {
    montantAReviser: number | null;
    coefficient: number | null;
    montantRevision: number | null;
    details: unknown;
  } | null;
}

export interface AttachementData {
  periode: Periode | null;
  isDernier: boolean;
  lignes: {
    prixNo: number;
    designation: string;
    unite: string;
    quantiteBordereau: number;
    quantitePrecedente: number;
    quantitePeriode: number;
    quantiteCumulee: number;
  }[];
}

export interface RevisionFormula {
  id: string;
  name: string;
  description: string | null;
  fixedPart: number;
  weights: Record<string, number>;
  isDefault: boolean;
}

export interface RevisionIndexMonth {
  id: string;
  monthDate: string;
  indexValues: Record<string, number>;
  source: string | null;
  notes: string | null;
  status: string;
  updatedAt: string;
}

export interface RevisionConfig {
  id: string;
  projectId: string;
  formulaId: string | null;
  baseIndexes: Record<string, number>;
  baseDate: string | null;
  isEnabled: boolean;
  notes: string | null;
}

export interface RevisionTableRow {
  decompteId: string;
  numero: number;
  periodeLibelle: string | null;
  montantAReviser: number;
  coefficient: number | null;
  montantRevision: number | null;
  totalDays?: number;
  details: { month: string; days: number; coefficient: number; missingIndexes?: boolean }[];
  missingMonths: string[];
  applied: boolean;
}

export interface RevisionView {
  config: RevisionConfig | null;
  formulas: RevisionFormula[];
  formula: RevisionFormula | null;
  indexes: RevisionIndexMonth[];
  table: RevisionTableRow[];
}

export interface Avenant {
  id: string;
  projectId: string;
  numero: number;
  objet: string;
  reference: string | null;
  typeAvenant: string;
  statut: string;
  dateAvenant: string | null;
  dateNotification: string | null;
  dateApprobation: string | null;
  montantDeltaMad: number;
  delaiDeltaMois: number;
  montantInitialMad: number | null;
  montantNouveauMad: number | null;
  pourcentageVariation: number | null;
  observations: string | null;
}

export interface AvenantsView {
  avenants: Avenant[];
  summary: BtpProjectDetail['situationContractuelle'];
}

export interface Ods {
  id: string;
  projectId: string;
  numero: number;
  reference: string | null;
  type: string;
  objet: string;
  description: string | null;
  motif: string | null;
  dateEmission: string | null;
  dateEffet: string | null;
  dateFin: string | null;
  delaiJours: number | null;
  impactFinancierMad: number;
  impactDelaiJours: number;
  emetteur: string | null;
  destinataire: string | null;
  statut: string;
  dateNotification: string | null;
  dateAccuseReception: string | null;
}

export interface Penalite {
  id: string;
  type: string;
  dateDebut: string | null;
  dateFin: string | null;
  nombreJours: number;
  taux: number;
  baseCalculMad: number | null;
  montantPenaliteMad: number;
  plafondPourcentage: number;
  montantPlafondMad: number | null;
  montantAppliqueMad: number;
  statut: string;
  motif: string | null;
}

export interface Caution {
  id: string;
  type: string;
  montantMad: number;
  pourcentage: number | null;
  organisme: string | null;
  referenceOrganisme: string | null;
  dateEmission: string | null;
  dateExpiration: string | null;
  dateMainlevee: string | null;
  statut: string;
}

export interface Retenue {
  id: string;
  decompteId: string | null;
  decompteNumero: number | null;
  montantDecompteMad: number | null;
  montantRetenueMad: number;
  montantCumuleMad: number | null;
  liberee: boolean;
  dateLiberation: string | null;
}

export interface PenalitesView {
  penalites: Penalite[];
  cautions: Caution[];
  retenues: Retenue[];
}

export interface ApprovalStep {
  id: string;
  stepOrder: number;
  stepLabel: string;
  role: string | null;
  status: string;
  decidedByName: string | null;
  decisionDate: string | null;
  comment: string | null;
}

export interface ApprovalRequest {
  id: string;
  documentType: string;
  documentReference: string | null;
  status: string;
  currentStep: number;
  totalSteps: number;
  priority: string;
  dueDate: string | null;
  note: string | null;
  montantMad: number | null;
  requestedByName: string | null;
  submittedAt: string;
  completedAt: string | null;
  steps: ApprovalStep[];
}

export interface Album {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  periodeId: string | null;
  photosCount: number;
}

export interface Asset {
  id: string;
  type: 'photo' | 'pv' | 'document';
  fileName: string | null;
  originalName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  albumId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  url: string | null;
}

export interface DelaiOverviewRow {
  project: {
    id: string;
    reference: string;
    objet: string;
    societe: string | null;
    status: string;
    ordreServiceDate: string | null;
    delaiMois: number | null;
    arrets: ArretTravaux[];
  };
  delai: DelaiInfo;
}

export interface Intervenants {
  assistanceTechnique: { name: string; count: number }[];
  maitreOeuvre: { name: string; count: number }[];
  societes: {
    name: string;
    rc: string | null;
    cb: string | null;
    cnss: string | null;
    patente: string | null;
    count: number;
  }[];
}

// ─── Badges ──────────────────────────────────────────────────────────────────

export interface BadgeSpec {
  label: string;
  classes: string;
}

export const PROJECT_STATUS_BADGES: Record<string, BadgeSpec> = {
  preparation: { label: 'Préparation', classes: 'bg-ochre-soft text-ochre' },
  en_cours: { label: 'En cours', classes: 'bg-cyan-soft text-cyan' },
  suspendu: { label: 'Suspendu', classes: 'bg-clay-soft text-clay' },
  receptionne: { label: 'Réceptionné', classes: 'bg-emerald-soft text-emerald' },
  clos: { label: 'Clos', classes: 'bg-sand text-muted' },
};

export const DECOMPTE_STATUS_BADGES: Record<string, BadgeSpec> = {
  draft: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  submitted: { label: 'Soumis', classes: 'bg-ochre-soft text-ochre' },
  validated: { label: 'Validé', classes: 'bg-cyan-soft text-cyan' },
  paid: { label: 'Payé', classes: 'bg-emerald-soft text-emerald' },
};

export const AVENANT_STATUS_BADGES: Record<string, BadgeSpec> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  en_attente: { label: 'En attente', classes: 'bg-ochre-soft text-ochre' },
  approuve: { label: 'Approuvé', classes: 'bg-emerald-soft text-emerald' },
  rejete: { label: 'Rejeté', classes: 'bg-clay-soft text-clay' },
  annule: { label: 'Annulé', classes: 'bg-sand text-faint' },
};

export const ODS_STATUS_BADGES: Record<string, BadgeSpec> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  emis: { label: 'Émis', classes: 'bg-cyan-soft text-cyan' },
  notifie: { label: 'Notifié', classes: 'bg-ochre-soft text-ochre' },
  accuse: { label: 'Accusé', classes: 'bg-teal-soft text-teal' },
  execute: { label: 'Exécuté', classes: 'bg-emerald-soft text-emerald' },
  cloture: { label: 'Clôturé', classes: 'bg-sand text-muted' },
  annule: { label: 'Annulé', classes: 'bg-clay-soft text-clay' },
};

export const ODS_ACTIONS_NEXT: Record<string, { action: string; label: string } | null> = {
  brouillon: { action: 'emit', label: 'Émettre' },
  emis: { action: 'notify', label: 'Notifier' },
  notifie: { action: 'acknowledge', label: 'Accuser réception' },
  accuse: { action: 'execute', label: 'Marquer exécuté' },
  execute: { action: 'close', label: 'Clôturer' },
  cloture: null,
  annule: null,
};

export const ODS_TYPE_LABELS: Record<string, string> = {
  commencement: 'Commencement des travaux',
  arret: 'Arrêt des travaux',
  reprise: 'Reprise des travaux',
  modification: 'Modification',
  travaux_supplementaires: 'Travaux supplémentaires',
  prolongation: 'Prolongation de délai',
  reception_provisoire: 'Réception provisoire',
  reception_definitive: 'Réception définitive',
  mise_en_demeure: 'Mise en demeure',
  autre: 'Autre',
};

export const PENALITE_STATUS_BADGES: Record<string, BadgeSpec> = {
  calculee: { label: 'Calculée', classes: 'bg-sand text-muted' },
  notifiee: { label: 'Notifiée', classes: 'bg-ochre-soft text-ochre' },
  contestee: { label: 'Contestée', classes: 'bg-cyan-soft text-cyan' },
  appliquee: { label: 'Appliquée', classes: 'bg-clay-soft text-clay' },
  annulee: { label: 'Annulée', classes: 'bg-sand text-faint' },
  remise: { label: 'Remise (grâce)', classes: 'bg-emerald-soft text-emerald' },
};

export const CAUTION_STATUS_BADGES: Record<string, BadgeSpec> = {
  en_attente: { label: 'En attente', classes: 'bg-sand text-muted' },
  active: { label: 'Active', classes: 'bg-cyan-soft text-cyan' },
  expiree: { label: 'Expirée', classes: 'bg-ochre-soft text-ochre' },
  liberee: { label: 'Libérée', classes: 'bg-emerald-soft text-emerald' },
  saisie: { label: 'Saisie', classes: 'bg-clay-soft text-clay' },
  annulee: { label: 'Annulée', classes: 'bg-sand text-faint' },
};

export const CAUTION_TYPE_LABELS: Record<string, string> = {
  caution_provisoire: 'Caution provisoire',
  caution_definitive: 'Caution définitive',
  retenue_garantie: 'Retenue de garantie',
  caution_avance: "Caution d'avance",
  caution_bonne_execution: 'Caution de bonne exécution',
  garantie_decennale: 'Garantie décennale',
};

export const APPROVAL_STATUS_BADGES: Record<string, BadgeSpec> = {
  en_attente: { label: 'En attente', classes: 'bg-sand text-muted' },
  en_cours: { label: 'En cours', classes: 'bg-cyan-soft text-cyan' },
  approuve: { label: 'Approuvé', classes: 'bg-emerald-soft text-emerald' },
  rejete: { label: 'Rejeté', classes: 'bg-clay-soft text-clay' },
  annule: { label: 'Annulé', classes: 'bg-sand text-faint' },
};

export const DELAI_STATUS_BADGES: Record<string, BadgeSpec> = {
  completed: { label: 'Terminé', classes: 'bg-emerald-soft text-emerald' },
  normal: { label: 'En cours', classes: 'bg-cyan-soft text-cyan' },
  warning: { label: '≤ 30 jours', classes: 'bg-ochre-soft text-ochre' },
  critical: { label: '≤ 15 jours', classes: 'bg-clay-soft text-clay' },
  overdue: { label: 'Dépassé', classes: 'bg-clay-soft text-clay' },
  unknown: { label: 'Sans OSC', classes: 'bg-sand text-faint' },
};

// ─── Formatters ──────────────────────────────────────────────────────────────

export function fmtMad(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value).toLocaleString('fr-MA')} MAD`;
}

export function fmtMadPrecise(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
}

export function fmtQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('fr-MA', { maximumFractionDigits: 4 });
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toLocaleString('fr-MA', { maximumFractionDigits: 1 })} %`;
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ─── Métré live calculation (mirror of the core engine) ─────────────────────

export const UNITES_BORDEREAU = ['M³', 'M²', 'ML', 'M', 'KG', 'T', 'U', 'ENS', 'FF', 'L'] as const;

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

export type MetreCalcType = 'volume' | 'surface' | 'lineaire' | 'poids' | 'unite';

export function metreCalcType(unite: string | null | undefined): MetreCalcType {
  const raw = (unite ?? '').trim().toUpperCase().replace('3', '³').replace('2', '²');
  if (raw === 'M³') return 'volume';
  if (raw === 'M²') return 'surface';
  if (raw === 'ML' || raw === 'M') return 'lineaire';
  if (raw === 'KG' || raw === 'T') return 'poids';
  return 'unite';
}

export const METRE_CHAMPS: Record<MetreCalcType, string[]> = {
  volume: ['nombreSemblables', 'longueur', 'largeur', 'profondeur'],
  surface: ['nombreSemblables', 'longueur', 'largeur'],
  lineaire: ['nombreSemblables', 'longueur'],
  poids: ['nombre', 'longueur', 'diametre'],
  unite: ['nombreSemblables', 'nombre'],
};

/** Live partiel — mirrors computeLignePartiel in the core engine. */
export function computeLignePartielClient(unite: string, ligne: MetreLigne): number {
  const type = metreCalcType(unite);
  const multiplier =
    ligne.nombreSemblables && ligne.nombreSemblables > 0 ? ligne.nombreSemblables : 1;
  const hasDims =
    ligne.longueur != null ||
    ligne.largeur != null ||
    ligne.profondeur != null ||
    ligne.nombre != null ||
    ligne.diametre != null;
  if (!hasDims) return ligne.partiel ?? 0;
  let result = 0;
  switch (type) {
    case 'volume':
      result = (ligne.longueur ?? 0) * (ligne.largeur ?? 0) * (ligne.profondeur ?? 0);
      break;
    case 'surface':
      result = (ligne.longueur ?? 0) * (ligne.largeur ?? 0);
      break;
    case 'lineaire':
      result = ligne.longueur ?? 0;
      break;
    case 'poids': {
      const kg =
        (ligne.nombre ?? 0) * (ligne.longueur ?? 0) * (POIDS_ACIER[ligne.diametre ?? 0] ?? 0);
      result = (unite ?? '').trim().toUpperCase() === 'T' ? kg / 1000 : kg;
      break;
    }
    case 'unite':
      result = ligne.nombre ?? 0;
      break;
  }
  return result * multiplier;
}

export function round2Client(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
