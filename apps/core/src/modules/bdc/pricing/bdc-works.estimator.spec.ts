import { describe, expect, test } from "vitest";
import type { NormalizedLine } from "./bdc-pricing.types";
import type { NormalizedObservation } from "./bdc-price-normalizer";
import { estimateWorksCost } from "./bdc-works.estimator";
import { weightedMedian, type PricingRateCard } from "./bdc-estimator.shared";

const worksLine: NormalizedLine = {
  idx: 0,
  category: "travaux",
  subcategory: "réparation",
  designation: "Reprise complète du joint",
  specification: "Ouverture, mortier, finition et évacuation",
  quantity: 10,
  unit: "ml",
  region: "Agadir",
  components: [
    { designation: "mortier de réparation", quantityFactor: 0.4, unit: "kg" },
    { designation: "main oeuvre maçon", quantityFactor: 0.2, unit: "h" },
  ],
  assumptions: [],
  blockers: [],
};

const rateCard: PricingRateCard = {
  version: "verified-2026-07",
  entries: [
    { designation: "mortier de réparation", unit: "kg", unitCostHtMad: 12, sourceIds: ["fac-1"] },
    { designation: "main oeuvre maçon", unit: "h", unitCostHtMad: 50, sourceIds: ["cost-1"] },
  ],
  wastePct: 5,
  siteOverheadPct: 10,
  deliveryPct: 4,
  installationPct: 8,
  warrantyRiskPct: 3,
  toolsPct: 4,
  serviceOverheadPct: 10,
  contingencyPct: 5,
};

describe("works cost estimator", () => {
  test("builds material, labor, waste and site-overhead cost without profit", () => {
    const result = estimateWorksCost(worksLine, [], rateCard);

    expect(result.category).toBe("travaux");
    expect(result.components.map((item) => item.label)).toEqual([
      "materiaux",
      "main_oeuvre",
      "dechets",
      "frais_chantier",
    ]);
    expect(result.components.every((item) => item.costHtMad >= 0)).toBe(true);
    expect(result.unitCostHtMad).toBe(
      result.components.reduce((sum, item) => sum + item.costHtMad, 0),
    );
    expect(result.unitCostHtMad).toBe(16.54);
  });

  test("prefers compatible observations over the fallback card", () => {
    const observation = {
      id: "obs-mortier",
      designation: "mortier de réparation",
      category: "travaux",
      unit: "kg",
      unitPriceHtMad: 20,
      comparableUnitPriceHtMad: 20,
      region: "Agadir",
      observedAt: "2026-07-01T00:00:00.000Z",
      sourceType: "facture",
      sourceRef: "FAC-2",
      sourceUrl: null,
      snapshotHash: "h2",
      verified: true,
      reliability: 1,
      compatibility: 1,
      freshness: 1,
      conversionNotes: [],
      metadata: {},
    } satisfies NormalizedObservation;

    expect(estimateWorksCost(worksLine, [observation], rateCard).unitCostHtMad).toBe(20.24);
  });

  test("computes a true weighted median and rejects unusable values", () => {
    expect(
      weightedMedian([
        { value: 10, weight: 1 },
        { value: 20, weight: 5 },
        { value: 1_000, weight: 1 },
      ]),
    ).toBe(20);
    expect(weightedMedian([{ value: -1, weight: 1 }, { value: 2, weight: 0 }])).toBeNull();
  });

  test("classifies equipment and transport and reports an unresolved component", () => {
    const expandedCard: PricingRateCard = {
      ...rateCard,
      entries: [
        ...rateCard.entries,
        { designation: "nacelle chantier", unit: "h", unitCostHtMad: 100, sourceIds: ["eq-1"] },
        { designation: "transport évacuation", unit: "u", unitCostHtMad: 80, sourceIds: ["tr-1"] },
      ],
    };
    const result = estimateWorksCost(
      {
        ...worksLine,
        components: [
          { designation: "nacelle chantier", quantityFactor: 0.1, unit: "h" },
          { designation: "transport évacuation", quantityFactor: 0.2, unit: "u" },
          { designation: "composant introuvable", quantityFactor: 1, unit: "kg" },
        ],
      },
      [],
      expandedCard,
    );

    expect(result.components.map((item) => item.label)).toEqual([
      "materiaux",
      "equipement",
      "transport",
      "dechets",
      "frais_chantier",
    ]);
    expect(result.assumptions).toContain("cout_manquant:composant introuvable");
  });

  test("handles a whole-line estimate when decomposition is absent", () => {
    const result = estimateWorksCost(
      { ...worksLine, designation: "prestation sans référence", components: [] },
      [],
      rateCard,
    );

    expect(result.unitCostHtMad).toBe(0);
    expect(result.components[0]?.label).toBe("materiaux");
  });

  test("falls back to a whole-work reference when generated components are unknown", () => {
    const result = estimateWorksCost(
      {
        ...worksLine,
        designation: "Reprise complète du joint",
        components: [
          { designation: "composant non détaillé", quantityFactor: 1, unit: "kg" },
        ],
      },
      [],
      {
        ...rateCard,
        entries: [
          {
            designation: "Reprise complète du joint",
            unit: worksLine.unit,
            unitCostHtMad: 250,
            sourceIds: ["work-global-1"],
          },
        ],
      },
    );

    expect(result.unitCostHtMad).toBeGreaterThan(250);
    expect(result.components[0]?.sourceIds).toEqual(["work-global-1"]);
    expect(result.assumptions).toContain("decomposition_remplacee_reference_globale");
  });
});
