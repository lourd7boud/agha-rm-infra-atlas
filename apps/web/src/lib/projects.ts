export type ProjectStatus =
  | 'preparation'
  | 'en_cours'
  | 'suspendu'
  | 'receptionne'
  | 'clos';

export interface ProjectSummary {
  id: string;
  reference: string;
  name: string;
  buyerName: string;
  montantMarcheMad: number;
  delaiMois?: number;
  status: ProjectStatus;
  situationsCount: number;
  montantCumuleMad: number;
  avancementPct: number;
  retenueCumuleeMad: number;
}

export type SituationStatus = 'brouillon' | 'soumis' | 'valide' | 'paye';

export interface Situation {
  id: string;
  numero: number;
  periodEnd: string;
  montantCumuleMad: number;
  montantPeriodeMad: number;
  retenueGarantieMad: number;
  netAPayerMad: number;
  avancementPct: number;
  status: SituationStatus;
  notes?: string;
}

export const PROJECT_STATUS_BADGES: Record<
  ProjectStatus,
  { label: string; classes: string }
> = {
  preparation: { label: 'Préparation', classes: 'bg-slate-100 text-slate-700' },
  en_cours: { label: 'En cours', classes: 'bg-emerald-100 text-emerald-800' },
  suspendu: { label: 'Suspendu', classes: 'bg-amber-100 text-amber-800' },
  receptionne: { label: 'Réceptionné', classes: 'bg-violet-100 text-violet-800' },
  clos: { label: 'Clos', classes: 'bg-slate-200 text-slate-500' },
};

export const SITUATION_STATUS_BADGES: Record<
  SituationStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-slate-100 text-slate-600' },
  soumis: { label: 'Soumis', classes: 'bg-amber-100 text-amber-800' },
  valide: { label: 'Validé', classes: 'bg-emerald-100 text-emerald-800' },
  paye: { label: 'Payé', classes: 'bg-violet-100 text-violet-800' },
};

/** Décompte workflow order — used to render the next-step button. */
export const SITUATION_NEXT: Partial<Record<SituationStatus, SituationStatus>> = {
  brouillon: 'soumis',
  soumis: 'valide',
  valide: 'paye',
};

export interface DailyLog {
  id: string;
  reportDate: string;
  effectifs: number;
  travauxRealises: string;
  materiel?: string;
  meteo?: string;
  blocages?: string;
  incidentsSecurite: number;
  createdBy: string;
}

export interface JournalResponse {
  summary: {
    jours: number;
    effectifMoyen: number;
    totalIncidents: number;
    blocagesOuverts: number;
    dernierRapport: string | null;
  };
  items: DailyLog[];
}

export interface Employee {
  id: string;
  fullName: string;
  metier: string;
  status: 'actif' | 'inactif';
}

export interface TeamMember {
  id: string;
  employeeId: string;
  fullName: string;
  metier: string;
  startDate: string;
  endDate?: string;
  actif: boolean;
}

export interface TeamResponse {
  effectifActif: number;
  membres: TeamMember[];
}

export function fmtMad(value: number): string {
  return `${Math.round(value).toLocaleString('fr-MA')} MAD`;
}
