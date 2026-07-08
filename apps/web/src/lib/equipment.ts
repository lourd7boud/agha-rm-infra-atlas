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
