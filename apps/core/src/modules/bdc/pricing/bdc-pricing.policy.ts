import Decimal from "decimal.js";
import type { PricingCategory, PricingGuard } from "./bdc-pricing.types";

export const MIN_COST_MARKUP_PCT = 15;

export interface ResolvePricingGuardInput {
  category: PricingCategory;
  estimationHt: number | null;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

export function applyMarkupFloor(
  costHt: number,
  requestedMarkupPct: number,
): number {
  assertFiniteNonNegative(costHt, "cost");
  assertFiniteNonNegative(requestedMarkupPct, "markup");

  const appliedMarkupPct = Math.max(
    MIN_COST_MARKUP_PCT,
    requestedMarkupPct,
  );

  return new Decimal(costHt)
    .mul(new Decimal(1).plus(new Decimal(appliedMarkupPct).div(100)))
    .toDecimalPlaces(2, Decimal.ROUND_CEIL)
    .toNumber();
}

export function resolvePricingGuard({
  category,
  estimationHt,
}: ResolvePricingGuardInput): PricingGuard {
  if (estimationHt === null) {
    return { lowerHt: null, upperHt: null, legalBasis: null };
  }

  if (!Number.isFinite(estimationHt) || estimationHt <= 0) {
    throw new RangeError("estimate must be a finite positive number");
  }

  const lowerRatio = category === "travaux" ? 0.8 : 0.75;

  return {
    lowerHt: new Decimal(estimationHt)
      .mul(lowerRatio)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
    upperHt: new Decimal(estimationHt)
      .mul(1.2)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
    legalBasis: "decret-2-22-431-art-44",
  };
}
