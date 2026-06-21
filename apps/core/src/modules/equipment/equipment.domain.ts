/**
 * Matériel & engins — pure status-transition rules. A machine is 'disponible'
 * when idle, 'assignee' while posted to a chantier, 'hors_service' when broken.
 * These guards are the single source of truth for which moves are legal; the
 * repository (InMemory + Drizzle) and the controller both lean on them so the
 * inventory status and the assignment log can never disagree. No I/O here.
 */

export const EQUIPMENT_STATUSES = [
  'disponible',
  'assignee',
  'hors_service',
] as const;

export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

/** Domain rule violation — mapped to HTTP 409 Conflict at the edge. */
export class EquipmentTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EquipmentTransitionError';
  }
}

/** A machine can be posted to a chantier only when it is idle. */
export function canAssign(status: EquipmentStatus): boolean {
  return status === 'disponible';
}

/** A machine can be returned only when it is currently posted. */
export function canReturn(status: EquipmentStatus): boolean {
  return status === 'assignee';
}

/** Throws EquipmentTransitionError when the machine is not assignable. */
export function assertAssign(status: EquipmentStatus): void {
  if (!canAssign(status)) {
    throw new EquipmentTransitionError(
      `Machine ${status} — seule une machine disponible peut être affectée`,
    );
  }
}

/** Throws EquipmentTransitionError when the machine is not returnable. */
export function assertReturn(status: EquipmentStatus): void {
  if (!canReturn(status)) {
    throw new EquipmentTransitionError(
      `Machine ${status} — seule une machine affectée peut être retournée`,
    );
  }
}

/**
 * Guards a manual status set (the hors_service / disponible toggle). Posting a
 * machine in/out of a chantier goes through assign/return, NOT here, so an open
 * assignment must never be stranded by a manual flip:
 *  - 'hors_service' is allowed only when the machine is idle (never mid-assignment),
 *  - 'disponible' is allowed only back from 'hors_service' (return frees an
 *    'assignee' machine instead),
 *  - 'assignee' is never set manually — affecter le matériel l'y amène.
 */
export function assertSetStatus(
  current: EquipmentStatus,
  next: EquipmentStatus,
): void {
  if (next === 'assignee') {
    throw new EquipmentTransitionError(
      'Affecter le matériel à un chantier pour le passer en service',
    );
  }
  if (next === 'hors_service' && current === 'assignee') {
    throw new EquipmentTransitionError(
      'Retourner la machine avant de la déclarer hors service',
    );
  }
  if (next === 'disponible' && current !== 'hors_service') {
    throw new EquipmentTransitionError(
      'Une machine ne redevient disponible que depuis hors service',
    );
  }
}
