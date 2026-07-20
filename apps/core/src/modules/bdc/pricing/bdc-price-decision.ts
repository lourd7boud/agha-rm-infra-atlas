import Decimal from "decimal.js";
import type { NormalizedObservation } from "./bdc-price-normalizer";
import type {
  CostEstimate,
  LinePricingDecision,
  NormalizedLine,
  PricingCategory,
  PricingConfidence,
  PricingMethod,
} from "./bdc-pricing.types";
import { weightedMedian, roundMad } from "./bdc-estimator.shared";
import { applyMarkupFloor, resolvePricingGuard } from "./bdc-pricing.policy";

export interface ScoredPriceEvidence {
  observation: NormalizedObservation;
  semanticFit: number;
  specificationCoverage: number;
  geographyFit: number;
}

export interface DecideLinePriceInput {
  line: NormalizedLine;
  estimate: CostEstimate;
  evidence: ScoredPriceEvidence[];
  requestedMarkupPct: number;
  manualPriceHt: number | null;
}

interface AcceptedEvidence extends ScoredPriceEvidence {
  score: number;
}

export interface OfferLineInput {
  category: PricingCategory;
  quantity: number;
  decision: LinePricingDecision;
}

export interface OptimizeOfferInput {
  principalCategory: PricingCategory;
  estimationHt: number | null;
  requestedMarkupPct?: number;
  lines: OfferLineInput[];
}

export interface OfferPricingDecision {
  decisions: LinePricingDecision[];
  totalHt: number;
  lowerHt: number | null;
  upperHt: number | null;
  nonViable: boolean;
  warnings: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreEvidence(candidate: ScoredPriceEvidence): number {
  const { observation } = candidate;
  return (
    clamp01(candidate.semanticFit) * 0.3 +
    clamp01(observation.compatibility) * 0.2 +
    clamp01(observation.reliability) * 0.15 +
    clamp01(observation.freshness) * 0.15 +
    clamp01(candidate.specificationCoverage) * 0.1 +
    clamp01(candidate.geographyFit) * 0.05 +
    (observation.verified ? 0.05 : 0)
  );
}

function numericMedian(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function removePriceOutliers(items: AcceptedEvidence[]): AcceptedEvidence[] {
  if (items.length < 3) return items;
  const median = numericMedian(
    items.map(({ observation }) => observation.comparableUnitPriceHtMad),
  );
  if (median === null) return [];
  const deviations = items.map(({ observation }) =>
    Math.abs(observation.comparableUnitPriceHtMad - median),
  );
  const mad = numericMedian(deviations) ?? 0;
  const threshold = mad === 0 ? Math.max(1, median * 0.1) : mad * 4.4478;
  return items.filter(
    ({ observation }) =>
      Math.abs(observation.comparableUnitPriceHtMad - median) <= threshold,
  );
}

function confidenceFor(items: AcceptedEvidence[]): PricingConfidence {
  if (items.length === 0) return "faible";
  const exactVerified = items.some(
    (item) =>
      item.observation.verified &&
      item.semanticFit >= 0.95 &&
      item.specificationCoverage >= 0.95 &&
      item.observation.compatibility === 1 &&
      item.observation.freshness >= 0.85,
  );
  const average = items.reduce((sum, item) => sum + item.score, 0) / items.length;
  if (exactVerified || (items.length >= 3 && average >= 0.7)) return "elevee";
  if (items.length >= 2 && average >= 0.55) return "moyenne";
  return "faible";
}

function methodFor(items: AcceptedEvidence[], estimate: CostEstimate): PricingMethod {
  if (
    items.some(
      (item) =>
        item.observation.verified &&
        item.semanticFit >= 0.95 &&
        item.specificationCoverage >= 0.95,
    )
  ) {
    return "reference_directe";
  }
  if (items.length >= 2) return "marche_pondere";
  if (estimate.assumptions.some((item) => item.startsWith("ia:"))) {
    return "ia_conservative";
  }
  return "decomposition";
}

function calculateMarkup(cost: number, price: number): number {
  if (cost <= 0) return 0;
  return roundMad(new Decimal(price).div(cost).minus(1).mul(100));
}

export function decideLinePrice({
  line,
  estimate,
  evidence,
  requestedMarkupPct,
  manualPriceHt,
}: DecideLinePriceInput): LinePricingDecision {
  if (manualPriceHt !== null && Number.isFinite(manualPriceHt) && manualPriceHt > 0) {
    return {
      idx: line.idx,
      estimatedCostHt: estimate.unitCostHtMad,
      proposedUnitPriceHt: manualPriceHt,
      rangeLowHt: manualPriceHt,
      rangeHighHt: manualPriceHt,
      markupPct: calculateMarkup(estimate.unitCostHtMad, manualPriceHt),
      confidence: "elevee",
      method: "reference_directe",
      sourceIds: [],
      explanation: "Prix manuel verrouillé et conservé sans modification.",
      warnings: [],
      manualPriceLocked: true,
    };
  }

  const accepted = removePriceOutliers(
    evidence
      .map((candidate) => ({ ...candidate, score: scoreEvidence(candidate) }))
      .filter(
        (candidate) =>
          candidate.score >= 0.35 &&
          candidate.observation.compatibility > 0 &&
          candidate.observation.comparableUnitPriceHtMad > 0,
      ),
  );
  const marketPrice = weightedMedian(
    accepted.map(({ observation, score }) => ({
      value: observation.comparableUnitPriceHtMad,
      weight: score,
    })),
  );
  const floor = applyMarkupFloor(estimate.unitCostHtMad, requestedMarkupPct);
  const proposedUnitPriceHt = roundMad(Math.max(floor, marketPrice ?? floor));
  const marketValues = accepted.map(
    ({ observation }) => observation.comparableUnitPriceHtMad,
  );
  const confidence = confidenceFor(accepted);
  const method = methodFor(accepted, estimate);
  const sourceIds = accepted
    .map(({ observation }) => observation.id)
    .filter((id): id is string => Boolean(id));

  return {
    idx: line.idx,
    estimatedCostHt: estimate.unitCostHtMad,
    proposedUnitPriceHt,
    rangeLowHt: roundMad(Math.max(floor, Math.min(...marketValues, floor))),
    rangeHighHt: roundMad(Math.max(floor, ...marketValues, estimate.highHtMad)),
    markupPct: calculateMarkup(estimate.unitCostHtMad, proposedUnitPriceHt),
    confidence,
    method,
    sourceIds: [...new Set(sourceIds)],
    explanation:
      accepted.length > 0
        ? `${accepted.length} référence(s) comparable(s), prix plancher de rentabilité respecté.`
        : "Estimation par décomposition, faute de référence comparable suffisante.",
    warnings: accepted.length === 0 ? ["preuves_marche_insuffisantes"] : [],
    manualPriceLocked: false,
  };
}

function lineTotal(line: OfferLineInput): number {
  return line.decision.proposedUnitPriceHt * Math.max(0, line.quantity);
}

function protectedFloor(line: OfferLineInput, requestedMarkupPct: number): number {
  if (line.decision.manualPriceLocked) return line.decision.proposedUnitPriceHt;
  return applyMarkupFloor(line.decision.estimatedCostHt, requestedMarkupPct);
}

function copyDecision(decision: LinePricingDecision): LinePricingDecision {
  return { ...decision, sourceIds: [...decision.sourceIds], warnings: [...decision.warnings] };
}

export function optimizeOffer({
  principalCategory,
  estimationHt,
  requestedMarkupPct = 15,
  lines,
}: OptimizeOfferInput): OfferPricingDecision {
  const working = lines.map((line) => ({
    ...line,
    quantity: Math.max(0, line.quantity),
    decision: copyDecision(line.decision),
  }));
  const warnings: string[] = [];
  if (new Set(working.map((line) => line.category)).size > 1) {
    warnings.push("offre_categories_mixtes");
  }

  const guard = resolvePricingGuard({ category: principalCategory, estimationHt });
  const total = () => roundMad(working.reduce((sum, line) => sum + lineTotal(line), 0));

  if (guard.lowerHt === null || guard.upperHt === null) {
    return {
      decisions: working.map((line) => line.decision),
      totalHt: total(),
      lowerHt: null,
      upperHt: null,
      nonViable: false,
      warnings,
    };
  }

  const minimumTotal = roundMad(
    working.reduce(
      (sum, line) => sum + protectedFloor(line, requestedMarkupPct) * line.quantity,
      0,
    ),
  );
  if (minimumTotal > guard.upperHt) {
    warnings.push("plancher_rentabilite_superieur_estimation");
    return {
      decisions: working.map((line) => line.decision),
      totalHt: total(),
      lowerHt: guard.lowerHt,
      upperHt: guard.upperHt,
      nonViable: true,
      warnings,
    };
  }

  const currentTotal = total();
  if (currentTotal < guard.lowerHt) {
    const adjustable = working.filter(
      (line) => !line.decision.manualPriceLocked && line.quantity > 0,
    );
    const weightTotal = adjustable.reduce(
      (sum, line) => sum + Math.max(0.01, line.decision.estimatedCostHt) * line.quantity,
      0,
    );
    if (adjustable.length === 0 || weightTotal <= 0) {
      warnings.push("prix_manuels_bloquent_corridor");
      return {
        decisions: working.map((line) => line.decision),
        totalHt: currentTotal,
        lowerHt: guard.lowerHt,
        upperHt: guard.upperHt,
        nonViable: true,
        warnings,
      };
    }
    const delta = guard.lowerHt - currentTotal;
    for (const line of adjustable) {
      const weight =
        (Math.max(0.01, line.decision.estimatedCostHt) * line.quantity) /
        weightTotal;
      const unitIncrease = (delta * weight) / line.quantity;
      line.decision.proposedUnitPriceHt = roundMad(
        line.decision.proposedUnitPriceHt + unitIncrease,
      );
      line.decision.markupPct = calculateMarkup(
        line.decision.estimatedCostHt,
        line.decision.proposedUnitPriceHt,
      );
    }
  } else if (currentTotal > guard.upperHt) {
    const adjustable = working.filter(
      (line) => !line.decision.manualPriceLocked && line.quantity > 0,
    );
    const capacities = adjustable.map((line) => ({
      line,
      capacity:
        Math.max(
          0,
          line.decision.proposedUnitPriceHt -
            protectedFloor(line, requestedMarkupPct),
        ) * line.quantity,
    }));
    const capacityTotal = capacities.reduce((sum, item) => sum + item.capacity, 0);
    const reduction = currentTotal - guard.upperHt;
    if (capacityTotal + 0.01 < reduction) {
      warnings.push("prix_manuels_bloquent_corridor");
      return {
        decisions: working.map((line) => line.decision),
        totalHt: currentTotal,
        lowerHt: guard.lowerHt,
        upperHt: guard.upperHt,
        nonViable: true,
        warnings,
      };
    }
    for (const { line, capacity } of capacities) {
      if (capacity <= 0) continue;
      const unitReduction = (reduction * (capacity / capacityTotal)) / line.quantity;
      line.decision.proposedUnitPriceHt = roundMad(
        Math.max(
          protectedFloor(line, requestedMarkupPct),
          line.decision.proposedUnitPriceHt - unitReduction,
        ),
      );
      line.decision.markupPct = calculateMarkup(
        line.decision.estimatedCostHt,
        line.decision.proposedUnitPriceHt,
      );
    }
  }

  const optimizedTotal = total();
  const nonViable = optimizedTotal < guard.lowerHt - 0.01 || optimizedTotal > guard.upperHt + 0.01;
  if (nonViable) warnings.push("arrondi_hors_corridor");
  return {
    decisions: working.map((line) => line.decision),
    totalHt: optimizedTotal,
    lowerHt: guard.lowerHt,
    upperHt: guard.upperHt,
    nonViable,
    warnings: [...new Set(warnings)],
  };
}
