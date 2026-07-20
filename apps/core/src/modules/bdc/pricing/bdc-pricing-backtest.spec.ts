import { describe, expect, test } from "vitest";
import { BASELINE_PRICING_CALIBRATION } from "./bdc-pricing.repository";
import {
  runBacktest,
  type PricingBacktestCase,
} from "./bdc-pricing-backtest";

const baseCase: PricingBacktestCase = {
  id: "case-1",
  category: "travaux",
  unit: "m2",
  region: "agadir",
  estimatedCostHt: 100,
  proposedUnitPriceHt: 120,
  actualCostHt: 100,
  hadProposal: true,
  oldMatcherHadProposal: false,
  manualOriginalPriceHt: null,
  manualAppliedPriceHt: null,
};

describe("pricing backtest", () => {
  test("reports coverage, MAPE and protected pricing invariants", () => {
    const report = runBacktest(
      [
        baseCase,
        {
          ...baseCase,
          id: "case-2",
          proposedUnitPriceHt: 110,
          oldMatcherHadProposal: true,
          manualOriginalPriceHt: 88,
          manualAppliedPriceHt: 90,
        },
      ],
      BASELINE_PRICING_CALIBRATION,
    );
    expect(report.totalCases).toBe(2);
    expect(report.agentCoveragePct).toBe(100);
    expect(report.oldMatcherCoveragePct).toBe(50);
    expect(report.mape).toBe(0);
    expect(report.profitableFloorViolations).toBe(1);
    expect(report.manualOverwriteViolations).toBe(1);
    expect(report.passesProtectedInvariants).toBe(false);
  });

  test("applies versioned segment factors and flags estimate corridors", () => {
    const report = runBacktest(
      [
        {
          ...baseCase,
          estimatedCostHt: 80,
          proposedUnitPriceHt: 138,
          actualCostHt: 120,
          estimateLowerHt: 110,
          estimateUpperHt: 130,
        },
      ],
      {
        ...BASELINE_PRICING_CALIBRATION,
        categoryFactors: { travaux: 1.25 },
        regionFactors: { agadir: 1.1 },
      },
    );
    expect(report.adjustedEstimates[0]?.estimatedCostHt).toBe(110);
    expect(report.mape).toBeCloseTo(8.3333, 3);
    expect(report.estimateCorridorWarnings).toBe(0);
    expect(report.profitableFloorViolations).toBe(0);
  });

  test("detects coverage regression against the legacy matcher", () => {
    const report = runBacktest(
      [{ ...baseCase, hadProposal: false, oldMatcherHadProposal: true }],
      BASELINE_PRICING_CALIBRATION,
    );
    expect(report.coverageRegressed).toBe(true);
    expect(report.passesProtectedInvariants).toBe(false);
  });
});
