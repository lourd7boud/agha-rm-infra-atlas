import { describe, expect, test } from "vitest";
import type { NormalizedLine } from "./bdc-pricing.types";
import type { PricingRateCard } from "./bdc-estimator.shared";
import { estimateSupplyCost } from "./bdc-supplies.estimator";

const rateCard: PricingRateCard = {
  version: "verified-2026-07",
  entries: [
    { designation: "Peinture ZENTIASTRAL 20 kg", unit: "u", unitCostHtMad: 500, sourceIds: ["quote-1"] },
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

function supplyLine(designation = "Peinture ZENTIASTRAL 20 kg ou équivalent"): NormalizedLine {
  return {
    idx: 0,
    category: "fournitures",
    subcategory: "peinture",
    designation,
    specification: "Livraison, installation et garantie demandées",
    quantity: 5,
    unit: "u",
    region: "Agadir",
    components: [],
    assumptions: [],
    blockers: [],
  };
}

describe("supply cost estimator", () => {
  test("adds purchase, delivery, installation and warranty risk", () => {
    const result = estimateSupplyCost(supplyLine(), [], rateCard);

    expect(result.components.map((item) => item.label)).toEqual([
      "achat_net",
      "livraison",
      "installation",
      "garantie_disponibilite",
    ]);
    expect(result.components.every((item) => item.costHtMad >= 0)).toBe(true);
    expect(result.unitCostHtMad).toBe(575);
    expect(result.unitCostHtMad).toBe(
      result.components.reduce((sum, item) => sum + item.costHtMad, 0),
    );
  });

  test("does not add installation or warranty when not requested", () => {
    const result = estimateSupplyCost(
      { ...supplyLine(), specification: "Fourniture et livraison" },
      [],
      rateCard,
    );

    expect(result.components.map((item) => item.label)).toEqual([
      "achat_net",
      "livraison",
    ]);
    expect(result.unitCostHtMad).toBe(520);
  });

  test("returns an explicit zero-cost assumption when purchase evidence is absent", () => {
    const result = estimateSupplyCost(
      supplyLine("Article totalement inconnu"),
      [],
      rateCard,
    );

    expect(result.unitCostHtMad).toBe(0);
    expect(result.assumptions).toContain("cout_achat_manquant");
  });
});
