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
  preparation: { label: 'Préparation', classes: 'bg-sand text-muted' },
  en_cours: { label: 'En cours', classes: 'bg-emerald-soft text-emerald' },
  suspendu: { label: 'Suspendu', classes: 'bg-ochre-soft text-ochre' },
  receptionne: { label: 'Réceptionné', classes: 'bg-cyan-soft text-cyan' },
  clos: { label: 'Clos', classes: 'bg-sand text-faint' },
};

export const SITUATION_STATUS_BADGES: Record<
  SituationStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  soumis: { label: 'Soumis', classes: 'bg-ochre-soft text-ochre' },
  valide: { label: 'Validé', classes: 'bg-emerald-soft text-emerald' },
  paye: { label: 'Payé', classes: 'bg-cyan-soft text-cyan' },
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

export type TaskStatus = 'a_faire' | 'en_cours' | 'termine' | 'bloque';

/** Tâche de chantier — frontend mirror of @atlas/core project task contract. */
export interface Task {
  id: string;
  projectId: string;
  label: string;
  description?: string;
  progressPct: number;
  status: TaskStatus;
  startDate?: string;
  dueDate?: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStatusSummary {
  a_faire: number;
  en_cours: number;
  termine: number;
  bloque: number;
}

/** GET /project/projects/:id/tasks envelope. */
export interface TasksResponse {
  tasks: Task[];
  physicalProgressPct: number;
  statusSummary: TaskStatusSummary;
}

export const TASK_STATUS_BADGES: Record<
  TaskStatus,
  { label: string; classes: string }
> = {
  a_faire: { label: 'À faire', classes: 'bg-sand text-muted' },
  en_cours: { label: 'En cours', classes: 'bg-emerald-soft text-emerald' },
  termine: { label: 'Terminé', classes: 'bg-cyan-soft text-cyan' },
  bloque: { label: 'Bloqué', classes: 'bg-ochre-soft text-ochre' },
};

/** Status options offered in the task forms, in workflow order. */
export const TASK_STATUS_OPTIONS: readonly { value: TaskStatus; label: string }[] =
  [
    { value: 'a_faire', label: 'À faire' },
    { value: 'en_cours', label: 'En cours' },
    { value: 'termine', label: 'Terminé' },
    { value: 'bloque', label: 'Bloqué' },
  ];

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

/** Pay basis for an assignment — daily or monthly rate. */
export type RateType = 'jour' | 'mois';

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  jour: 'jour',
  mois: 'mois',
};

/** Per-worker line of GET /people/projects/:id/labor (mirrors @atlas/core). */
export interface ProjectLaborLine {
  employeeId: string;
  fullName: string;
  metier: string;
  rateType?: RateType | null;
  rateAmountMad?: number | null;
  totalDays: number;
  duesMad: number;
}

/** GET /people/projects/:id/labor envelope. */
export interface ProjectLabor {
  lines: ProjectLaborLine[];
  totalDays: number;
  totalDuesMad: number;
}

/**
 * One project's cost position — frontend mirror of @atlas/core ProjectCost.
 * coutTotalMad = matériaux + main-d'œuvre + dépenses; restantMad = budget − coût;
 * margePct = budget > 0 ? restant / budget × 100 : 0. incomesMad (encaissements)
 * is carried through but never folded into the cost.
 */
export interface ProjectCost {
  budgetMad: number;
  materialsCostMad: number;
  laborCostMad: number;
  expensesMad: number;
  coutTotalMad: number;
  restantMad: number;
  margePct: number;
  incomesMad?: number;
}

/** GET /project/projects/cost-summary line — one ProjectCost keyed by project. */
export interface ProjectCostSummary extends ProjectCost {
  projectId: string;
}

export function fmtMad(value: number): string {
  return `${Math.round(value).toLocaleString('fr-MA')} MAD`;
}

/** Renders a margin/percentage as "12,3 %" (one decimal, fr-MA). */
export function fmtPct(value: number): string {
  return `${value.toLocaleString('fr-MA', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/**
 * Tone for a remaining-budget / margin figure: emerald when the chantier is
 * still in the black (≥ 0), clay once the cost overruns the budget (< 0).
 * Mirrors the finance page's net-position coloring.
 */
export function costToneClass(value: number): string {
  return value < 0 ? 'text-clay' : 'text-emerald';
}

/** A worked-days count, trimmed of trailing zeros (e.g. "1" / "0,5" / "12,5"). */
export function fmtDays(value: number): string {
  return value.toLocaleString('fr-MA', { maximumFractionDigits: 2 });
}

/** Renders a rate as "300 MAD/jour", or a dash when no rate is set. */
export function fmtRate(
  rateType: RateType | null | undefined,
  rateAmountMad: number | null | undefined,
): string {
  if (!rateType || !rateAmountMad) return '—';
  return `${fmtMad(rateAmountMad)}/${RATE_TYPE_LABELS[rateType]}`;
}
