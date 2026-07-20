import { describe, expect, test } from "vitest";
import type { NormalizedLine } from "./bdc-pricing.types";
import type { PricingRateCard } from "./bdc-estimator.shared";
import { estimateServiceCost } from "./bdc-services.estimator";

const serviceLine: NormalizedLine = {
  idx: 0,
  category: "services",
  subcategory: "audit",
  designation: "Audit technique avec rapport et déplacement Agadir",
  specification: "Rapport signé, outils et déplacement inclus",
  quantity: 1,
  unit: "forfait",
  region: "Agadir",
  components: [
    { designation: "ingénieur senior", quantityFactor: 2, unit: "jour" },
    { designation: "déplacement", quantityFactor: 1, unit: "forfait" },
  ],
  assumptions: [],
  blockers: [],
};

const rateCard: PricingRateCard = {
  version: "verified-2026-07",
  entries: [
    { designation: "ingénieur senior", unit: "jour", unitCostHtMad: 1_500, sourceIds: ["payroll-1"] },
    { designation: "déplacement", unit: "forfait", unitCostHtMad: 500, sourceIds: ["expense-1"] },
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

describe("service cost estimator", () => {
  test("adds role effort, travel, tools, overhead and risk", () => {
    const result = estimateServiceCost(serviceLine, [], rateCard);

    expect(result.components.map((item) => item.label)).toEqual([
      "effort_roles",
      "deplacement",
      "outils_licences",
      "frais_generaux",
      "alea",
    ]);
    expect(result.components.every((item) => item.costHtMad >= 0)).toBe(true);
    expect(result.unitCostHtMad).toBe(4_204.2);
    expect(result.unitCostHtMad).toBe(
      result.components.reduce((sum, item) => sum + item.costHtMad, 0),
    );
  });

  test("handles an undecomposed service with no matching evidence", () => {
    const result = estimateServiceCost(
      {
        ...serviceLine,
        designation: "Service spécialisé inconnu",
        components: [],
      },
      [],
      rateCard,
    );

    expect(result.unitCostHtMad).toBe(0);
    expect(result.assumptions).toContain("effort_service_manquant");
    expect(result.components.map((item) => item.label)).not.toContain("deplacement");
  });

  test("uses a verified rate-card row for an undecomposed forfait", () => {
    const result = estimateServiceCost(
      { ...serviceLine, components: [] },
      [],
      {
        ...rateCard,
        entries: [
          ...rateCard.entries,
          {
            designation: "Audit technique avec rapport",
            unit: "forfait",
            unitCostHtMad: 3_200,
            sourceIds: ["approved-1"],
          },
        ],
      },
    );

    expect(result.components[0]).toMatchObject({
      label: "effort_roles",
      costHtMad: 3_200,
      sourceIds: ["approved-1"],
    });
    expect(result.assumptions).toContain("bareme:verified-2026-07:service");
  });

  test("labels a missing decomposed role cost", () => {
    const result = estimateServiceCost(
      {
        ...serviceLine,
        components: [
          { designation: "expert introuvable", quantityFactor: 1, unit: "jour" },
        ],
      },
      [],
      rateCard,
    );

    expect(result.assumptions).toContain("cout_manquant:expert introuvable");
  });

  test("falls back to a compatible whole-service reference when roles are unknown", () => {
    const result = estimateServiceCost(
      {
        ...serviceLine,
        components: [
          { designation: "profil non détaillé", quantityFactor: 1, unit: "jour" },
        ],
      },
      [],
      {
        ...rateCard,
        entries: [
          {
            designation: serviceLine.designation,
            unit: "forfait",
            unitCostHtMad: 3_500,
            sourceIds: ["service-global-1"],
          },
        ],
      },
    );

    expect(result.unitCostHtMad).toBeGreaterThan(3_500);
    expect(result.components[0]?.sourceIds).toEqual(["service-global-1"]);
    expect(result.assumptions).toContain("decomposition_remplacee_reference_globale");
  });
});
