// Types + formatteurs du module Comptabilité (miroir des records de l'API
// /compta/*). Mêmes conventions d'affichage que le reste d'ATLAS : montants
// mono tabular-nums, dates dd/MM/yyyy, badges par statut.

export interface ComptaProfil {
  id: string;
  raisonSociale: string;
  formeJuridique: string;
  capitalSocial: number | null;
  registreCommerce: string | null;
  identifiantFiscal: string | null;
  ice: string | null;
  taxeProfessionnelle: string | null;
  cnssAffiliation: string | null;
  adresse: string | null;
  ville: string | null;
  gerant: string | null;
  dateCreation: string | null;
  exerciceClotureMois: number;
  regimeTva: 'mensuel' | 'trimestriel';
  prorataTva: number;
  tauxIs: number;
  tauxCotisationMinimale: number;
  effectif: number | null;
  assujettiTp: boolean;
  exonerationTpJusquau: string | null;
  notes: string | null;
}

export interface Exercice {
  id: string;
  annee: number;
  dateDebut: string;
  dateFin: string;
  statut: 'ouvert' | 'cloture';
  resultatNet: number | null;
}

export interface Compte {
  code: string;
  intitule: string;
  classe: number;
  parentCode: string | null;
  isCustom: boolean;
  actif: boolean;
}

export interface Journal {
  code: string;
  intitule: string;
  type: string;
  actif: boolean;
}

export interface EcritureLigne {
  id: string;
  compteCode: string;
  compteIntitule?: string;
  libelle: string | null;
  debit: number;
  credit: number;
  tiers: string | null;
  ordre: number;
}

export interface Ecriture {
  id: string;
  journalCode: string;
  numero: number;
  dateEcriture: string;
  pieceRef: string | null;
  libelle: string;
  statut: 'brouillon' | 'validee';
  source: string;
  totalDebit: number;
  totalCredit: number;
  createdBy: string | null;
  lignes?: EcritureLigne[];
}

export interface GrandLivreLigne {
  ecritureId: string;
  journalCode: string;
  numero: number;
  dateEcriture: string;
  pieceRef: string | null;
  libelle: string;
  debit: number;
  credit: number;
  solde: number;
}

export interface BalanceRow {
  compteCode: string;
  intitule: string;
  classe: number;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

export interface EtatPoste {
  label: string;
  montant: number;
}

export interface EtatsSynthese {
  cpc: {
    produitsExploitation: number;
    chargesExploitation: number;
    resultatExploitation: number;
    produitsFinanciers: number;
    chargesFinancieres: number;
    resultatFinancier: number;
    produitsNonCourants: number;
    chargesNonCourantes: number;
    resultatNonCourant: number;
    impotsResultats: number;
    resultatNet: number;
    postesCharges: EtatPoste[];
    postesProduits: EtatPoste[];
  };
  bilan: {
    actifImmobilise: number;
    actifCirculant: number;
    tresorerieActif: number;
    totalActif: number;
    financementPermanent: number;
    passifCirculant: number;
    tresoreriePassif: number;
    resultatPeriode: number;
    totalPassif: number;
  };
}

export interface TvaDeclaration {
  id: string;
  periodeKey: string;
  regime: string;
  dateEcheance: string;
  tvaCollectee: number;
  tvaDeductibleCharges: number;
  tvaDeductibleImmo: number;
  creditAnterieur: number;
  tvaDue: number;
  creditNouveau: number;
  statut: string;
  dateDeclaration: string | null;
  datePaiement: string | null;
  reference: string | null;
  note: string | null;
}

export interface DeclarationFiscale {
  id: string;
  type: string;
  annee: number;
  periodeKey: string;
  label: string;
  base: number | null;
  montant: number;
  dateEcheance: string;
  statut: string;
  dateDeclaration: string | null;
  datePaiement: string | null;
  reference: string | null;
  note: string | null;
}

export interface SocialDeclaration {
  id: string;
  periodeKey: string;
  masseSalariale: number;
  massePlafonnee: number;
  effectif: number;
  partSalariale: number;
  partPatronale: number;
  totalCotisations: number;
  detail: Record<string, { patronal: number; salarial: number }>;
  dateEcheance: string;
  statut: string;
  dateDeclaration: string | null;
  datePaiement: string | null;
  reference: string | null;
  note: string | null;
}

export interface AnnuiteAmortissement {
  annee: number;
  dotation: number;
  cumul: number;
  vnc: number;
}

export interface Immobilisation {
  id: string;
  designation: string;
  compteCode: string;
  categorie: string;
  dateAcquisition: string;
  dateMiseEnService: string | null;
  valeurHt: number;
  tauxAmortissement: number;
  statut: string;
  dateSortie: string | null;
  prixCession: number | null;
  fournisseur: string | null;
  pieceRef: string | null;
  note: string | null;
  dotationExercice: number;
  cumulAmortissements: number;
  vnc: number;
  plan?: AnnuiteAmortissement[];
}

export interface BanqueCompte {
  id: string;
  banque: string;
  agence: string | null;
  rib: string | null;
  devise: string;
  soldeInitial: number;
  dateSoldeInitial: string | null;
  statut: string;
  note: string | null;
  solde: number;
  mouvementsNonRapproches: number;
}

export interface BanqueMouvement {
  id: string;
  compteId: string;
  dateMouvement: string;
  libelle: string;
  montant: number;
  reference: string | null;
  rapproche: boolean;
  note: string | null;
}

export interface LegalDocument {
  id: string;
  type: string;
  titre: string;
  annee: number | null;
  dateEmission: string | null;
  dateExpiration: string | null;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  note: string | null;
  createdAt: string;
}

export interface Obligation {
  id: string;
  annee: number;
  type: string;
  label: string;
  dateEcheance: string;
  statut: 'a_faire' | 'fait' | 'na';
  dateFait: string | null;
  note: string | null;
}

export type Urgence = 'fait' | 'en_retard' | 'urgent' | 'proche' | 'a_venir';

export interface EcheanceDashboard {
  source: 'fiscal' | 'tva' | 'social' | 'obligation' | 'document';
  id: string;
  label: string;
  dateEcheance: string;
  statut: string;
  montant: number | null;
  urgence: Urgence;
}

export interface ComptaDashboard {
  profil: ComptaProfil;
  exercices: Exercice[];
  exerciceCourant: Exercice | null;
  resultatProvisoire: number;
  chiffreAffaires: number;
  tresorerie: number;
  echeances: EcheanceDashboard[];
  compteurs: { enRetard: number; sous30Jours: number; total: number };
  tvaCourante: TvaDeclaration | null;
  ficheLegaleManquants: string[];
  veille: Array<{ titre: string; detail: string; impact: 'important' | 'a_suivre' }>;
}

// ── Formatteurs ──────────────────────────────────────────────────────────────

const madFormatter = new Intl.NumberFormat('fr-MA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMad(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${madFormatter.format(value)} MAD`;
}

export function fmtMadCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M MAD`;
  if (abs >= 10_000) return `${Math.round(value / 1_000)} k MAD`;
  return fmtMad(value);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

export function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} Mo`;
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} Ko`;
  return `${bytes} o`;
}

// ── Badges & libellés ────────────────────────────────────────────────────────

export const URGENCE_BADGES: Record<Urgence, { label: string; className: string }> = {
  en_retard: { label: 'En retard', className: 'bg-clay-soft/60 text-clay' },
  urgent: { label: '≤ 7 jours', className: 'bg-clay-soft/40 text-clay' },
  proche: { label: '≤ 30 jours', className: 'bg-ochre-soft/50 text-ochre' },
  a_venir: { label: 'À venir', className: 'bg-sand text-muted' },
  fait: { label: 'Fait', className: 'bg-emerald-soft/50 text-emerald' },
};

export const STATUT_DECLARATION_BADGES: Record<string, { label: string; className: string }> = {
  a_venir: { label: 'À venir', className: 'bg-sand text-muted' },
  a_preparer: { label: 'À préparer', className: 'bg-ochre-soft/50 text-ochre' },
  a_declarer: { label: 'À déclarer', className: 'bg-ochre-soft/50 text-ochre' },
  declaree: { label: 'Déclarée', className: 'bg-cyan-soft/50 text-cyan' },
  payee: { label: 'Payée', className: 'bg-emerald-soft/50 text-emerald' },
  a_faire: { label: 'À faire', className: 'bg-ochre-soft/50 text-ochre' },
  fait: { label: 'Fait', className: 'bg-emerald-soft/50 text-emerald' },
  na: { label: 'N/A', className: 'bg-sand text-faint' },
  brouillon: { label: 'Brouillon', className: 'bg-sand text-muted' },
  validee: { label: 'Validée', className: 'bg-emerald-soft/50 text-emerald' },
  ouvert: { label: 'Ouvert', className: 'bg-cyan-soft/50 text-cyan' },
  cloture: { label: 'Clôturé', className: 'bg-sand text-muted' },
  actif: { label: 'Actif', className: 'bg-emerald-soft/50 text-emerald' },
  cede: { label: 'Cédé', className: 'bg-ochre-soft/50 text-ochre' },
  sorti: { label: 'Sorti', className: 'bg-sand text-faint' },
  expire: { label: 'Expiré', className: 'bg-clay-soft/60 text-clay' },
  a_renouveler: { label: 'À renouveler', className: 'bg-ochre-soft/50 text-ochre' },
};

export const SOURCE_ECHEANCE_LABELS: Record<EcheanceDashboard['source'], string> = {
  fiscal: 'Impôts',
  tva: 'TVA',
  social: 'CNSS',
  obligation: 'Obligation',
  document: 'Document',
};

export const TYPE_DOCUMENT_LABELS: Record<string, string> = {
  attestation_fiscale: 'Attestation de régularité fiscale',
  attestation_cnss: 'Attestation CNSS',
  attestation_tp: 'Attestation taxe professionnelle',
  rc_modele_j: 'Modèle J (registre de commerce)',
  statuts: 'Statuts de la société',
  pv_ag: "PV d'assemblée générale",
  liasse_fiscale: 'Liasse fiscale',
  bilan: 'Bilan / états de synthèse',
  quitus: 'Quitus fiscal',
  contrat: 'Contrat',
  autre: 'Autre document',
};

export const CATEGORIE_IMMO_LABELS: Record<string, string> = {
  constructions: 'Constructions',
  materiel_technique: 'Installations techniques & outillage',
  materiel_transport: 'Matériel de transport',
  mobilier_bureau: 'Mobilier de bureau',
  materiel_informatique: 'Matériel informatique',
  agencements: 'Agencements & aménagements',
  terrains: 'Terrains',
  autre: 'Autre',
};

export const CLASSE_LABELS: Record<number, string> = {
  1: 'Financement permanent',
  2: 'Actif immobilisé',
  3: 'Actif circulant',
  4: 'Passif circulant',
  5: 'Trésorerie',
  6: 'Charges',
  7: 'Produits',
  8: 'Résultats',
};

export function periodeLabel(periodeKey: string): string {
  if (periodeKey.includes('-T')) {
    const [annee, t] = periodeKey.split('-');
    return `${t} ${annee}`;
  }
  const [annee = '', mois = ''] = periodeKey.split('-');
  const noms = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];
  return `${noms[Number(mois) - 1] ?? mois} ${annee}`;
}
