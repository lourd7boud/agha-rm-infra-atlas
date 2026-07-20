import { describe, expect, test } from "vitest";
import type { NormalizedObservation } from "./bdc-price-normalizer";
import type { CostEstimate, NormalizedLine } from "./bdc-pricing.types";
import {
  decideLinePrice,
  optimizeOffer,
  type ScoredPriceEvidence,
} from "./bdc-price-decision";

const line: NormalizedLine = {
  idx: 0,
  category: "travaux",
  subcategory: "joint",
  designation: "Reprise complète du joint",
  specification: "mortier hydrofuge",
  quantity: 1,
  unit: "ml",
  region: "Agadir",
  components: [],
  assumptions: [],
  blockers: [],
};

const estimate: CostEstimate = {
  category: "travaux",
  unitCostHtMad: 100,
  lowHtMad: 90,
  highHtMad: 120,
  assumptions: [],
  components: [{ label: "cout", costHtMad: 100, sourceIds: ["cost-1"] }],
};

function evidence(
  price: number,
  overrides: Partial<ScoredPriceEvidence> = {},
): ScoredPriceEvidence {
  const observation: NormalizedObservation = {
    id: `obs-${price}`,
    designation: line.designation,
    category: "travaux",
    unit: "ml",
    unitPriceHtMad: price,
    comparableUnitPriceHtMad: price,
    region: "Agadir",
    observedAt: "2026-07-19T00:00:00.000Z",
    sourceType: "facture",
    sourceRef: `FAC-${price}`,
    sourceUrl: null,
    snapshotHash: `hash-${price}`,
    verified: true,
    reliability: 1,
    compatibility: 1,
    freshness: 1,
    conversionNotes: [],
    metadata: {},
  };
  return {
    observation,
    semanticFit: 1,
    specificationCoverage: 1,
    geographyFit: 1,
    ...overrides,
  };
}

describe("line price decision", () => {
  test("gives a recent exact verified reference high confidence", () => {
    const decision = decideLinePrice({
      line,
      estimate,
      evidence: [evidence(150)],
      requestedMarkupPct: 15,
      manualPriceHt: null,
    });

    expect(decision).toMatchObject({
      proposedUnitPriceHt: 150,
      confidence: "elevee",
      method: "reference_directe",
      sourceIds: ["obs-150"],
    });
  });

  test("excludes incompatible units", () => {
    const incompatible = evidence(500, {
      observation: { ...evidence(500).observation, compatibility: 0 },
    });
    const decision = decideLinePrice({
      line,
      estimate,
      evidence: [incompatible],
      requestedMarkupPct: 15,
      manualPriceHt: null,
    });

    expect(decision.proposedUnitPriceHt).toBe(115);
    expect(decision.sourceIds).toEqual([]);
  });

  test("removes an extreme price using median absolute deviation", () => {
    const decision = decideLinePrice({
      line,
      estimate,
      evidence: [evidence(100), evidence(102), evidence(5_000)],
      requestedMarkupPct: 15,
      manualPriceHt: null,
    });

    expect(decision.proposedUnitPriceHt).toBe(115);
    expect(decision.sourceIds).not.toContain("obs-5000");
  });

  test("falls back to decomposition with low confidence", () => {
    const decision = decideLinePrice({
      line,
      estimate,
      evidence: [],
      requestedMarkupPct: 5,
      manualPriceHt: null,
    });

    expect(decision).toMatchObject({
      proposedUnitPriceHt: 115,
      confidence: "faible",
      method: "decomposition",
    });
  });

  test("never prices below the requested margin or the 15 percent floor", () => {
    expect(
      decideLinePrice({
        line,
        estimate,
        evidence: [evidence(50)],
        requestedMarkupPct: 20,
        manualPriceHt: null,
      }).proposedUnitPriceHt,
    ).toBe(120);
  });

  test("returns a manual price byte-for-byte unchanged", () => {
    const decision = decideLinePrice({
      line,
      estimate,
      evidence: [evidence(150)],
      requestedMarkupPct: 15,
      manualPriceHt: 87.65,
    });

    expect(decision.proposedUnitPriceHt).toBe(87.65);
    expect(decision.manualPriceLocked).toBe(true);
  });
});

function baseDecision(idx: number, cost: number, proposed: number) {
  return {
    idx,
    estimatedCostHt: cost,
    proposedUnitPriceHt: proposed,
    rangeLowHt: proposed,
    rangeHighHt: proposed,
    markupPct: ((proposed / cost) - 1) * 100,
    confidence: "moyenne" as const,
    method: "decomposition" as const,
    sourceIds: [],
    explanation: "test",
    warnings: [],
    manualPriceLocked: false,
  };
}

describe("offer optimizer", () => {
  test("raises a feasible works offer into the 0.80E..1.20E corridor", () => {
    const result = optimizeOffer({
      principalCategory: "travaux",
      estimationHt: 1_000,
      lines: [
        { category: "travaux", quantity: 1, decision: baseDecision(0, 200, 230) },
        { category: "travaux", quantity: 1, decision: baseDecision(1, 200, 230) },
      ],
    });

    expect(result.totalHt).toBe(800);
    expect(result.nonViable).toBe(false);
    expect(result.decisions.every((item) => item.proposedUnitPriceHt >= 230)).toBe(true);
  });

  test.each(["fournitures", "services"] as const)(
    "uses the 0.75E lower edge for %s",
    (category) => {
      const result = optimizeOffer({
        principalCategory: category,
        estimationHt: 1_000,
        lines: [
          { category, quantity: 1, decision: baseDecision(0, 200, 230) },
          { category, quantity: 1, decision: baseDecision(1, 200, 230) },
        ],
      });

      expect(result.totalHt).toBe(750);
    },
  );

  test("marks a cost floor above the upper corridor non-viable without cutting margin", () => {
    const result = optimizeOffer({
      principalCategory: "travaux",
      estimationHt: 1_000,
      lines: [
        { category: "travaux", quantity: 1, decision: baseDecision(0, 600, 690) },
        { category: "travaux", quantity: 1, decision: baseDecision(1, 600, 690) },
      ],
    });

    expect(result.nonViable).toBe(true);
    expect(result.totalHt).toBe(1_380);
    expect(result.decisions.map((item) => item.proposedUnitPriceHt)).toEqual([690, 690]);
  });

  test("retains a warning for mixed-category subtotals", () => {
    const result = optimizeOffer({
      principalCategory: "travaux",
      estimationHt: null,
      lines: [
        { category: "travaux", quantity: 1, decision: baseDecision(0, 100, 115) },
        { category: "services", quantity: 1, decision: baseDecision(1, 100, 115) },
      ],
    });

    expect(result.warnings).toContain("offre_categories_mixtes");
  });
});
