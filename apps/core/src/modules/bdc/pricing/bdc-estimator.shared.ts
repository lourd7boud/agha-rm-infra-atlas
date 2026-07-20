import Decimal from "decimal.js";
import type { NormalizedObservation } from "./bdc-price-normalizer";
import type {
  CostEstimate,
  CostEstimateComponent,
  NormalizedLine,
  PricingCategory,
} from "./bdc-pricing.types";

export interface PricingRateCardEntry {
  designation: string;
  unit: string;
  unitCostHtMad: number;
  sourceIds: string[];
}

export interface PricingRateCard {
  version: string;
  entries: PricingRateCardEntry[];
  wastePct: number;
  siteOverheadPct: number;
  deliveryPct: number;
  installationPct: number;
  warrantyRiskPct: number;
  toolsPct: number;
  serviceOverheadPct: number;
  contingencyPct: number;
}

export interface ResolvedComponentCost {
  unitCostHtMad: number;
  sourceIds: string[];
  usedFallback: boolean;
}

export function roundMad(value: number | Decimal): number {
  return new Decimal(value)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function weightedMedian(
  values: Array<{ value: number; weight: number }>,
): number | null {
  const usable = values
    .filter(
      ({ value, weight }) =>
        Number.isFinite(value) &&
        value >= 0 &&
        Number.isFinite(weight) &&
        weight > 0,
    )
    .sort((left, right) => left.value - right.value);

  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (usable.length === 0 || totalWeight <= 0) return null;

  const midpoint = totalWeight / 2;
  let cumulative = 0;
  for (const item of usable) {
    cumulative += item.weight;
    if (cumulative >= midpoint) return item.value;
  }
  return usable.at(-1)?.value ?? null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    fold(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

export function designationSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return fold(left) === fold(right) ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

export function resolveComponentCost(
  designation: string,
  unit: string,
  observations: NormalizedObservation[],
  rateCard: PricingRateCard,
): ResolvedComponentCost | null {
  const comparable = observations
    .filter(
      (item) =>
        item.unit === unit &&
        item.compatibility > 0 &&
        item.comparableUnitPriceHtMad >= 0 &&
        designationSimilarity(designation, item.designation) >= 0.3,
    )
    .map((item) => ({
      item,
      weight:
        Math.max(0, item.reliability) *
        Math.max(0, item.freshness) *
        Math.max(0, item.compatibility) *
        Math.max(0.3, designationSimilarity(designation, item.designation)),
    }))
    .filter(({ weight }) => weight > 0);

  const observedMedian = weightedMedian(
    comparable.map(({ item, weight }) => ({
      value: item.comparableUnitPriceHtMad,
      weight,
    })),
  );
  if (observedMedian !== null) {
    return {
      unitCostHtMad: roundMad(observedMedian),
      sourceIds: comparable
        .map(({ item }) => item.id)
        .filter((id): id is string => Boolean(id)),
      usedFallback: false,
    };
  }

  const fallback = rateCard.entries
    .filter((entry) => entry.unit === unit && entry.unitCostHtMad >= 0)
    .map((entry) => ({
      entry,
      similarity: designationSimilarity(designation, entry.designation),
    }))
    .filter(({ similarity }) => similarity >= 0.3)
    .sort((left, right) => right.similarity - left.similarity)[0]?.entry;

  return fallback
    ? {
        unitCostHtMad: roundMad(fallback.unitCostHtMad),
        sourceIds: fallback.sourceIds,
        usedFallback: true,
      }
    : null;
}

export function percentageComponent(
  label: string,
  base: number,
  pct: number,
  sourceIds: string[] = [],
): CostEstimateComponent {
  const safePct = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  return {
    label,
    costHtMad: roundMad(new Decimal(base).mul(safePct).div(100)),
    sourceIds,
  };
}

export function finishEstimate(
  category: PricingCategory,
  components: CostEstimateComponent[],
  assumptions: string[],
): CostEstimate {
  const sanitized = components.map((component) => ({
    ...component,
    costHtMad:
      Number.isFinite(component.costHtMad) && component.costHtMad >= 0
        ? roundMad(component.costHtMad)
        : 0,
    sourceIds: [...new Set(component.sourceIds)],
  }));
  const unitCostHtMad = roundMad(
    sanitized.reduce((sum, component) => sum + component.costHtMad, 0),
  );

  return {
    category,
    unitCostHtMad,
    lowHtMad: roundMad(new Decimal(unitCostHtMad).mul(0.9)),
    highHtMad: roundMad(new Decimal(unitCostHtMad).mul(1.15)),
    assumptions: [...new Set(assumptions)],
    components: sanitized,
  };
}

export function resolveWholeLineCost(
  line: NormalizedLine,
  observations: NormalizedObservation[],
  rateCard: PricingRateCard,
): ResolvedComponentCost | null {
  return resolveComponentCost(
    line.designation,
    line.unit,
    observations,
    rateCard,
  );
}
