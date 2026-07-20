import type {
  PricingCalibration,
  PricingCategory,
} from "./bdc-pricing.types";

export interface PricingBacktestCase {
  id: string;
  category: PricingCategory;
  unit: string;
  region: string | null;
  estimatedCostHt: number;
  proposedUnitPriceHt: number;
  actualCostHt: number;
  hadProposal: boolean;
  oldMatcherHadProposal: boolean;
  manualOriginalPriceHt: number | null;
  manualAppliedPriceHt: number | null;
  estimateLowerHt?: number | null;
  estimateUpperHt?: number | null;
}

export interface AdjustedBacktestEstimate {
  id: string;
  estimatedCostHt: number;
  actualCostHt: number;
  proposedUnitPriceHt: number;
}

export interface PricingBacktestReport {
  calibrationVersion: string;
  totalCases: number;
  agentCoveragePct: number;
  oldMatcherCoveragePct: number;
  mape: number | null;
  realizedMarkupPct: number | null;
  profitableFloorViolations: number;
  manualOverwriteViolations: number;
  estimateCorridorWarnings: number;
  coverageRegressed: boolean;
  passesProtectedInvariants: boolean;
  adjustedEstimates: AdjustedBacktestEstimate[];
}

export function runBacktest(
  cases: readonly PricingBacktestCase[],
  calibration: PricingCalibration,
): PricingBacktestReport {
  const adjustedEstimates = cases.map((item) => {
    const categoryFactor = calibration.categoryFactors[item.category] ?? 1;
    const regionFactor = item.region
      ? (calibration.regionFactors[fold(item.region)] ?? 1)
      : 1;
    const unitFactor = calibration.unitFactors[fold(item.unit)] ?? 1;
    return {
      id: item.id,
      estimatedCostHt: roundMoney(
        item.estimatedCostHt * categoryFactor * regionFactor * unitFactor,
      ),
      actualCostHt: item.actualCostHt,
      proposedUnitPriceHt: item.proposedUnitPriceHt,
    };
  });
  const proposed = cases.filter((item) => item.hadProposal).length;
  const oldProposed = cases.filter((item) => item.oldMatcherHadProposal).length;
  const agentCoveragePct = percentage(proposed, cases.length);
  const oldMatcherCoveragePct = percentage(oldProposed, cases.length);
  const comparable = adjustedEstimates.filter(
    (item) => item.actualCostHt > 0 && Number.isFinite(item.actualCostHt),
  );
  const mape = comparable.length
    ? average(
        comparable.map(
          (item) =>
            (Math.abs(item.estimatedCostHt - item.actualCostHt) /
              item.actualCostHt) *
            100,
        ),
      )
    : null;
  const markupCases = cases.filter(
    (item) => item.hadProposal && item.actualCostHt > 0,
  );
  const realizedMarkupPct = markupCases.length
    ? average(
        markupCases.map(
          (item) =>
            ((item.proposedUnitPriceHt / item.actualCostHt) - 1) * 100,
        ),
      )
    : null;
  const profitableFloorViolations = markupCases.filter(
    (item) => item.proposedUnitPriceHt + 0.005 < item.actualCostHt * 1.15,
  ).length;
  const manualOverwriteViolations = cases.filter(
    (item) =>
      item.manualOriginalPriceHt !== null &&
      item.manualAppliedPriceHt !== null &&
      item.manualOriginalPriceHt !== item.manualAppliedPriceHt,
  ).length;
  const estimateCorridorWarnings = adjustedEstimates.filter((adjusted, index) => {
    const source = cases[index]!;
    return (
      (source.estimateLowerHt != null &&
        adjusted.estimatedCostHt < source.estimateLowerHt) ||
      (source.estimateUpperHt != null &&
        adjusted.estimatedCostHt > source.estimateUpperHt)
    );
  }).length;
  const coverageRegressed = agentCoveragePct < oldMatcherCoveragePct;

  return {
    calibrationVersion: calibration.version,
    totalCases: cases.length,
    agentCoveragePct,
    oldMatcherCoveragePct,
    mape: nullableRound(mape),
    realizedMarkupPct: nullableRound(realizedMarkupPct),
    profitableFloorViolations,
    manualOverwriteViolations,
    estimateCorridorWarnings,
    coverageRegressed,
    passesProtectedInvariants:
      profitableFloorViolations === 0 &&
      manualOverwriteViolations === 0 &&
      !coverageRegressed,
    adjustedEstimates,
  };
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : roundMetric((count / total) * 100);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function nullableRound(value: number | null): number | null {
  return value === null ? null : roundMetric(value);
}
