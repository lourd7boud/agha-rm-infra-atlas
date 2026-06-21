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

/**
 * GET /equipment/projects/:id row — a machine on the chantier with its open
 * assignment inline (affecté-le / retour-prévu), so the project view needs no
 * per-machine getEquipment fetch.
 */
export interface ProjectEquipmentRecord extends EquipmentRecord {
  openAssignment: EquipmentAssignmentRecord;
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

/** A date formatted fr-MA (short), or a dash when absent. */
export function fmtDate(value: string | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA');
}

export { fmtMad };
