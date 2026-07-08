/**
 * Matériel & engins — GMAO domain rules (documents, meters, work orders).
 *
 * Pure, I/O-free logic layered on top of the equipment register. Mirrors the
 * discipline of equipment.domain.ts: this file is the single source of truth for
 * the maintenance vocabulary + the moves the repositories (InMemory + Drizzle)
 * and controller are allowed to make, so the two stores can never disagree.
 *
 *  - Documents carry compliance dates (assurance, carte grise, contrôle
 *    technique…); documentExpiryStatus turns an expiry date into a badge state.
 *  - Meters accumulate machine usage (heures / km); currentMeterValue reads the
 *    latest value from a reading log (usage drives preventive maintenance).
 *  - Work orders (bons d'intervention) are préventif or correctif and move
 *    ouvert → en_cours → clos; assertWorkOrderTransition guards the lifecycle.
 */

// ── Documents ────────────────────────────────────────────────────────────────

/** Compliance document types tracked per machine (Moroccan fleet reality). */
export const EQUIPMENT_DOCUMENT_TYPES = [
  'assurance',
  'carte_grise',
  'controle_technique',
  'visite_technique',
  'autorisation',
  'autre',
] as const;

export type EquipmentDocumentType = (typeof EQUIPMENT_DOCUMENT_TYPES)[number];

/** How many days before expiry a document starts warning on the dashboard. */
export const DOCUMENT_EXPIRY_WARN_DAYS = 30;

/**
 * A document's compliance state:
 *  - 'permanent'      — no expiry date (nothing to renew),
 *  - 'valide'         — expires beyond the warning window,
 *  - 'expire_bientot' — expires within DOCUMENT_EXPIRY_WARN_DAYS (today included),
 *  - 'expire'         — expiry date is already past.
 */
export type DocumentExpiryStatus =
  | 'permanent'
  | 'valide'
  | 'expire_bientot'
  | 'expire';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day UTC epoch for a date, so comparisons ignore the time-of-day. */
function toUtcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Classifies a document by its expiry date relative to `today`. Day-granular
 * (time-of-day is ignored) so a document expiring at any point today reads as
 * 'expire_bientot', and one whose expiry day is past reads as 'expire'.
 */
export function documentExpiryStatus(
  expiryDate: Date | undefined,
  today: Date,
  warnWithinDays: number = DOCUMENT_EXPIRY_WARN_DAYS,
): DocumentExpiryStatus {
  if (!expiryDate) return 'permanent';
  const diffDays = Math.floor(
    (toUtcMidnight(expiryDate) - toUtcMidnight(today)) / MS_PER_DAY,
  );
  if (diffDays < 0) return 'expire';
  if (diffDays <= warnWithinDays) return 'expire_bientot';
  return 'valide';
}

// ── Meters ───────────────────────────────────────────────────────────────────

/** Usage units a meter can accumulate. Heures for engines, km for vehicles. */
export const METER_UNITS = ['heures', 'km'] as const;

export type MeterUnit = (typeof METER_UNITS)[number];

/** Minimal shape currentMeterValue needs from a reading (store-agnostic). */
export interface MeterReadingLike {
  value: number;
  readingDate: Date;
  createdAt: Date;
}

/**
 * The machine's current meter value = the value of the most recent reading,
 * newest reading date first, ties broken by insertion order (later createdAt
 * wins). Returns null when nothing has been recorded yet. Readings are never
 * mutated (a defensive copy is sorted).
 */
export function currentMeterValue(
  readings: readonly MeterReadingLike[],
): number | null {
  if (readings.length === 0) return null;
  const [latest] = [...readings].sort((a, b) => {
    const byDate = b.readingDate.getTime() - a.readingDate.getTime();
    if (byDate !== 0) return byDate;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return latest!.value;
}

// ── Work orders (bons d'intervention) ────────────────────────────────────────

/** Corrective (breakdown) vs preventive (scheduled) intervention. */
export const WORK_ORDER_TYPES = ['preventif', 'correctif'] as const;

export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

/** Lifecycle: ouvert → en_cours → clos (clos is terminal). */
export const WORK_ORDER_STATUSES = ['ouvert', 'en_cours', 'clos'] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Domain rule violation — mapped to HTTP 409 Conflict at the edge. */
export class WorkOrderTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkOrderTransitionError';
  }
}

/** The only moves allowed out of each status (forward-only; clos is terminal). */
const WORK_ORDER_ALLOWED: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  ouvert: ['en_cours', 'clos'],
  en_cours: ['clos'],
  clos: [],
};

/**
 * Guards a work-order status change. Only forward moves are legal; a closed
 * work order is terminal and a no-op (same → same) transition is rejected so
 * callers cannot silently overwrite completion metadata.
 */
export function assertWorkOrderTransition(
  current: WorkOrderStatus,
  next: WorkOrderStatus,
): void {
  if (!WORK_ORDER_ALLOWED[current].includes(next)) {
    throw new WorkOrderTransitionError(
      `Transition interdite : ${current} → ${next}`,
    );
  }
}
