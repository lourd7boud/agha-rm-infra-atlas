/**
 * Matériel & engins — amortissement linéaire (straight-line depreciation).
 *
 * Pure, I/O-free. The book value of a machine falls evenly from its acquisition
 * cost to its salvage value over depreciation_months, starting at the
 * acquisition date. Used to surface "valeur comptable actuelle" per engin and,
 * later, a fleet asset-value rollup. Amounts are MAD; months are whole.
 */

export interface DepreciationInput {
  acquisitionCostMad?: number;
  acquisitionDate?: Date;
  depreciationMonths?: number;
  /** Valeur résiduelle at end of life; defaults to 0. */
  salvageValueMad?: number;
}

export interface DepreciationResult {
  /** True only when cost, months (>0) and acquisition date are all known. */
  applicable: boolean;
  /** Cost − accumulated, never below salvage; null when not applicable. */
  bookValueMad: number | null;
  /** Total depreciated so far; null when not applicable. */
  accumulatedMad: number | null;
  /** Depreciation charged per month; null when not applicable. */
  monthlyMad: number | null;
  /** Whole months elapsed since acquisition (clamped to ≥0). */
  elapsedMonths: number | null;
  /** The scheduled depreciation duration in months. */
  totalMonths: number | null;
  fullyDepreciated: boolean;
}

/** Whole months from `from` to `to` (clamped ≥0), day-of-month aware. */
function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Straight-line depreciation as of `asOf`. Returns applicable=false (all nulls)
 * unless cost, a positive month count, and an acquisition date are all present.
 * Depreciation accrues on (cost − salvage) evenly per month and is capped at the
 * schedule end, so the book value never falls below the salvage value.
 */
export function straightLineDepreciation(
  input: DepreciationInput,
  asOf: Date,
): DepreciationResult {
  const cost = input.acquisitionCostMad;
  const months = input.depreciationMonths;
  const acquiredAt = input.acquisitionDate;

  if (cost == null || months == null || months <= 0 || !acquiredAt) {
    return {
      applicable: false,
      bookValueMad: null,
      accumulatedMad: null,
      monthlyMad: null,
      elapsedMonths: null,
      totalMonths: null,
      fullyDepreciated: false,
    };
  }

  const salvage = input.salvageValueMad ?? 0;
  const base = Math.max(0, cost - salvage);
  const monthly = base / months;
  const elapsed = monthsBetween(acquiredAt, asOf);
  const chargedMonths = Math.min(elapsed, months);
  const accumulated = monthly * chargedMonths;
  const bookValue = cost - accumulated;

  return {
    applicable: true,
    bookValueMad: bookValue,
    accumulatedMad: accumulated,
    monthlyMad: monthly,
    elapsedMonths: elapsed,
    totalMonths: months,
    fullyDepreciated: elapsed >= months,
  };
}
