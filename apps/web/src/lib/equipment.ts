import { fmtMad } from './projects';

/**
 * Matériel & engins — frontend mirror of the @atlas/core equipment module
 * contract (apps/core/src/modules/equipment). Dates arrive as ISO strings
 * (the repository surfaces Postgres date/timestamp as strings over HTTP).
 */

export type EquipmentStatus = 'disponible' | 'assignee' | 'hors_service';

export interface EquipmentRecord {
  id: string;
  code?: string;
  name: string;
  category?: string;
  marque?: string;
  modele?: string;
  numeroSerie?: string;
  immatriculation?: string;
  status: EquipmentStatus;
  acquisitionDate?: string;
  acquisitionCostMad?: number;
  depreciationMonths?: number;
  salvageValueMad?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentAssignmentRecord {
  id: string;
  equipmentId: string;
  projectId: string;
  assignedAt: string;
  expectedReturnAt?: string;
  returnedAt?: string;
  notes?: string;
  createdAt: string;
}

/** GET /equipment/:id envelope — machine + open assignment + full history. */
export interface EquipmentDetail {
  equipment: EquipmentRecord;
  openAssignment: EquipmentAssignmentRecord | null;
  history: EquipmentAssignmentRecord[];
}

/** One DB page of fleet rows + the total matching count (mirrors core Paged<T>). */
export interface Paged<T> {
  items: T[];
  total: number;
}

/**
 * GET /equipment/summary envelope — DB-computed status tallies over the WHOLE
 * parc (correct regardless of paging) plus the total. Mirrors core
 * EquipmentSummary.
 */
export interface EquipmentSummary {
  counts: Record<EquipmentStatus, number>;
  total: number;
}

/**
 * GET /equipment/projects/:id row — a machine on the chantier with its open
 * assignment inline (affecté-le / retour-prévu), so the project view needs no
 * per-machine getEquipment fetch.
 */
export interface ProjectEquipmentRecord extends EquipmentRecord {
  openAssignment: EquipmentAssignmentRecord;
}

// ── GMAO: documents / meters / work orders ───────────────────────────────────

export type EquipmentDocumentType =
  | 'assurance'
  | 'carte_grise'
  | 'controle_technique'
  | 'visite_technique'
  | 'autorisation'
  | 'autre';

export type DocumentExpiryStatus =
  | 'permanent'
  | 'valide'
  | 'expire_bientot'
  | 'expire';

export type MeterUnit = 'heures' | 'km';
export type WorkOrderType = 'preventif' | 'correctif';
export type WorkOrderStatus = 'ouvert' | 'en_cours' | 'clos';

export interface EquipmentDocumentRecord {
  id: string;
  equipmentId: string;
  type: EquipmentDocumentType;
  reference?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  createdAt: string;
}

/** GET /equipment/documents/alerts row — a document needing attention. */
export interface ExpiringDocument extends EquipmentDocumentRecord {
  equipmentName: string;
  status: DocumentExpiryStatus;
}

export interface EquipmentMeterReadingRecord {
  id: string;
  equipmentId: string;
  readingDate: string;
  value: number;
  unit: MeterUnit;
  source: string;
  notes?: string;
  createdAt: string;
}

/** GET /equipment/:id/meter — the machine's current meter (null when none). */
export interface CurrentMeter {
  value: number;
  unit: MeterUnit;
}

export interface EquipmentWorkOrderRecord {
  id: string;
  equipmentId: string;
  planId?: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  title: string;
  description?: string;
  reportedBy?: string;
  openedAt: string;
  completedAt?: string;
  meterAtService?: number;
  costMad?: number;
  resolution?: string;
  createdAt: string;
}

/** Status → French label + badge classes (mirrors PROJECT_STATUS_BADGES). */
export const EQUIPMENT_STATUS_BADGES: Record<
  EquipmentStatus,
  { label: string; classes: string }
> = {
  disponible: { label: 'Disponible', classes: 'bg-emerald-soft text-emerald' },
  assignee: { label: 'Affectée', classes: 'bg-cyan-soft text-cyan' },
  hors_service: { label: 'Hors service', classes: 'bg-clay-soft text-clay' },
};

/** Statuses surfaced as KPI tiles, in lifecycle order. */
export const EQUIPMENT_STATUS_ORDER: readonly EquipmentStatus[] = [
  'disponible',
  'assignee',
  'hors_service',
];

/** Document type → French label. */
export const DOCUMENT_TYPE_LABELS: Record<EquipmentDocumentType, string> = {
  assurance: 'Assurance',
  carte_grise: 'Carte grise',
  controle_technique: 'Contrôle technique',
  visite_technique: 'Visite technique',
  autorisation: 'Autorisation',
  autre: 'Autre',
};

export const DOCUMENT_TYPE_ORDER: readonly EquipmentDocumentType[] = [
  'assurance',
  'carte_grise',
  'controle_technique',
  'visite_technique',
  'autorisation',
  'autre',
];

/** Expiry status → label + badge classes. */
export const DOCUMENT_EXPIRY_BADGES: Record<
  DocumentExpiryStatus,
  { label: string; classes: string }
> = {
  permanent: { label: 'Permanent', classes: 'bg-sand text-muted' },
  valide: { label: 'Valide', classes: 'bg-emerald-soft text-emerald' },
  expire_bientot: {
    label: 'Expire bientôt',
    classes: 'bg-ochre-soft text-ochre',
  },
  expire: { label: 'Expiré', classes: 'bg-clay-soft text-clay' },
};

export const METER_UNIT_LABELS: Record<MeterUnit, string> = {
  heures: 'heures',
  km: 'km',
};

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  preventif: 'Préventif',
  correctif: 'Correctif',
};

export const WORK_ORDER_STATUS_BADGES: Record<
  WorkOrderStatus,
  { label: string; classes: string }
> = {
  ouvert: { label: 'Ouvert', classes: 'bg-cyan-soft text-cyan' },
  en_cours: { label: 'En cours', classes: 'bg-ochre-soft text-ochre' },
  clos: { label: 'Clos', classes: 'bg-emerald-soft text-emerald' },
};

// ── GMAO: preventive maintenance plans ───────────────────────────────────────

export type MaintenanceTriggerType = 'meter' | 'temps';
export type PlanDueStatus = 'a_jour' | 'bientot' | 'en_retard';

export interface PlanDueResult {
  status: PlanDueStatus;
  nextDueMeter: number | null;
  remainingMeter: number | null;
  nextDueDate: string | null;
  remainingDays: number | null;
}

export interface MaintenancePlanRecord {
  id: string;
  equipmentId: string;
  name: string;
  triggerType: MaintenanceTriggerType;
  meterUnit?: MeterUnit;
  intervalMeter?: number;
  lastServiceMeter?: number;
  intervalDays?: number;
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

/** GET /equipment/:id/maintenance-plans row — plan + live due status. */
export interface MaintenancePlanWithStatus extends MaintenancePlanRecord {
  due: PlanDueResult;
}

/** GET /equipment/maintenance/due row — a due plan with its machine name. */
export interface DuePlan extends MaintenancePlanWithStatus {
  equipmentName: string;
}

export const MAINTENANCE_TRIGGER_LABELS: Record<MaintenanceTriggerType, string> =
  {
    meter: 'Compteur',
    temps: 'Temps',
  };

export const PLAN_DUE_BADGES: Record<
  PlanDueStatus,
  { label: string; classes: string }
> = {
  a_jour: { label: 'À jour', classes: 'bg-emerald-soft text-emerald' },
  bientot: { label: 'Bientôt', classes: 'bg-ochre-soft text-ochre' },
  en_retard: { label: 'En retard', classes: 'bg-clay-soft text-clay' },
};

/** Human "prochaine échéance" for a plan (meter value+unit, or a date). */
export function fmtPlanNextDue(plan: MaintenancePlanWithStatus): string {
  if (plan.triggerType === 'meter') {
    if (plan.due.nextDueMeter === null) return '—';
    const unit = plan.meterUnit ? ` ${METER_UNIT_LABELS[plan.meterUnit]}` : '';
    return `${plan.due.nextDueMeter.toLocaleString('fr-MA')}${unit}`;
  }
  return fmtDate(plan.due.nextDueDate ?? undefined);
}

/** Human "reste" until a plan is due (heures/km or jours). */
export function fmtPlanRemaining(plan: MaintenancePlanWithStatus): string {
  if (plan.triggerType === 'meter') {
    if (plan.due.remainingMeter === null) return '—';
    const unit = plan.meterUnit ? ` ${METER_UNIT_LABELS[plan.meterUnit]}` : '';
    return `${plan.due.remainingMeter.toLocaleString('fr-MA')}${unit}`;
  }
  if (plan.due.remainingDays === null) return '—';
  return `${plan.due.remainingDays} j`;
}

export const MAINTENANCE_INTERVAL_LABEL: Record<MaintenanceTriggerType, string> =
  {
    meter: 'Intervalle (heures/km)',
    temps: 'Intervalle (jours)',
  };

// ── GMAO: inspections / checklists ───────────────────────────────────────────

export type InspectionType =
  | 'avant_affectation'
  | 'retour_chantier'
  | 'periodique'
  | 'securite';
export type InspectionResult = 'conforme' | 'reserves' | 'non_conforme';
export type InspectionItemStatus = 'ok' | 'defaut' | 'na';

export interface InspectionItemRecord {
  id: string;
  inspectionId: string;
  label: string;
  status: InspectionItemStatus;
  notes?: string;
  createdAt: string;
}

export interface InspectionItemSummary {
  ok: number;
  defaut: number;
  na: number;
  total: number;
}

export interface InspectionRecord {
  id: string;
  equipmentId: string;
  type: InspectionType;
  inspectionDate: string;
  inspectedBy?: string;
  result: InspectionResult;
  notes?: string;
  createdAt: string;
}

/** GET /equipment/:id/inspections row — inspection + items + tally. */
export interface InspectionWithItems extends InspectionRecord {
  items: InspectionItemRecord[];
  summary: InspectionItemSummary;
}

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  avant_affectation: 'Avant affectation',
  retour_chantier: 'Retour chantier',
  periodique: 'Périodique',
  securite: 'Sécurité',
};

export const INSPECTION_TYPE_ORDER: readonly InspectionType[] = [
  'avant_affectation',
  'retour_chantier',
  'periodique',
  'securite',
];

export const INSPECTION_RESULT_BADGES: Record<
  InspectionResult,
  { label: string; classes: string }
> = {
  conforme: { label: 'Conforme', classes: 'bg-emerald-soft text-emerald' },
  reserves: { label: 'Réserves', classes: 'bg-ochre-soft text-ochre' },
  non_conforme: { label: 'Non conforme', classes: 'bg-clay-soft text-clay' },
};

export const INSPECTION_ITEM_STATUS_BADGES: Record<
  InspectionItemStatus,
  { label: string; classes: string }
> = {
  ok: { label: 'OK', classes: 'bg-emerald-soft text-emerald' },
  defaut: { label: 'Défaut', classes: 'bg-clay-soft text-clay' },
  na: { label: 'N/A', classes: 'bg-sand text-muted' },
};

export const INSPECTION_ITEM_STATUS_ORDER: readonly InspectionItemStatus[] = [
  'ok',
  'defaut',
  'na',
];

// ── GMAO: depreciation (amortissement linéaire) ──────────────────────────────

export interface DepreciationResult {
  applicable: boolean;
  bookValueMad: number | null;
  accumulatedMad: number | null;
  monthlyMad: number | null;
  elapsedMonths: number | null;
  totalMonths: number | null;
  fullyDepreciated: boolean;
}

/**
 * Presentational mirror of the core documentExpiryStatus rule (30-day window),
 * for badging a machine's own document list where the API returns the raw doc.
 * The fleet alerts endpoint already carries a server-computed status.
 */
export const DOCUMENT_EXPIRY_WARN_DAYS = 30;

export function documentExpiryStatus(
  expiry: string | undefined,
): DocumentExpiryStatus {
  if (!expiry) return 'permanent';
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const exp = new Date(expiry);
  const expUtc = Date.UTC(
    exp.getUTCFullYear(),
    exp.getUTCMonth(),
    exp.getUTCDate(),
  );
  const diffDays = Math.floor((expUtc - todayUtc) / MS_PER_DAY);
  if (diffDays < 0) return 'expire';
  if (diffDays <= DOCUMENT_EXPIRY_WARN_DAYS) return 'expire_bientot';
  return 'valide';
}

/** A date formatted fr-MA (short), or a dash when absent. */
export function fmtDate(value: string | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA');
}

/** A meter value + unit, or a dash when null. */
export function fmtMeter(current: CurrentMeter | null): string {
  if (!current) return '—';
  return `${current.value.toLocaleString('fr-MA')} ${METER_UNIT_LABELS[current.unit]}`;
}

export { fmtMad };
