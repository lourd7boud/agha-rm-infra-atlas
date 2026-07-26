import { afterEach, describe, expect, test, vi } from "vitest";
import { FakeLlmClient } from "../../brain/llm.client";
import { BdcAiEstimator } from "./bdc-ai-estimator";
import type { NormalizedLine } from "./bdc-pricing.types";

const line: NormalizedLine = {
  idx: 0,
  category: "services",
  subcategory: "expertise",
  designation: "Contrôle et expertise techniques",
  specification: "",
  quantity: 1,
  unit: "forfait",
  region: "Skhirate-Témara",
  components: [],
  assumptions: [],
  blockers: [],
};

describe("BDC conservative AI estimator", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("returns a bounded direct-cost estimate without fabricated sources", async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        lines: [
          {
            idx: 0,
            unitCostHtMad: 10_000,
            lowHtMad: 12_000,
            highHtMad: 9_000,
            components: [
              { label: "expertise laboratoire", costHtMad: 10_000 },
            ],
            assumptions: ["visite et rapport inclus"],
          },
        ],
      }),
    ]);
    const estimator = new BdcAiEstimator(llm);

    const result = await estimator.estimate(
      [line],
      [
        {
          id: "web-1",
          designation: "Expertise bâtiment",
          category: "services",
          unit: "forfait",
          unitPriceHtMad: 9_000,
          region: "Rabat",
          observedAt: "2026-07-26T00:00:00.000Z",
          sourceType: "web",
          sourceRef: "Référence publique",
          sourceUrl: "https://example.ma/prix",
          snapshotHash: "a".repeat(64),
          verified: false,
          reliability: 0.6,
          metadata: { pricingLineIdx: 0 },
        },
      ],
    );

    expect(result.get(0)).toMatchObject({
      unitCostHtMad: 10_000,
      lowHtMad: 10_000,
      highHtMad: 10_000,
      components: [
        {
          label: "expertise laboratoire",
          costHtMad: 10_000,
          sourceIds: ["web-1"],
        },
      ],
    });
    expect(result.get(0)?.assumptions).toContain(
      "ia:estimation_conservative_sans_preuve_verifiee",
    );
    expect(llm.requests[0]?.system).toContain("N'invente ni source");
    expect(llm.requests[0]?.prompt).toContain("Référence publique");
  });

  test("does nothing when no LLM is configured", async () => {
    expect(await new BdcAiEstimator(null).estimate([line])).toEqual(new Map());
  });

  test("never prices silver iodide below its landed raw-silver floor", async () => {
    vi.stubEnv("BDC_SILVER_SPOT_MAD_PER_GRAM", "17.52");
    const llm = new FakeLlmClient([
      JSON.stringify({
        lines: [
          {
            idx: 0,
            unitCostHtMad: 2_500,
            lowHtMad: 2_000,
            highHtMad: 3_000,
            components: [{ label: "produit", costHtMad: 2_500 }],
            assumptions: [],
          },
        ],
      }),
    ]);
    const estimator = new BdcAiEstimator(llm);
    const result = await estimator.estimate([
      {
        ...line,
        category: "fournitures",
        designation: "Iodure d’argent",
        unit: "kg",
      },
    ]);

    expect(result.get(0)?.unitCostHtMad).toBeGreaterThan(10_000);
    expect(result.get(0)?.assumptions).toContain(
      "plancher_matiere:argent_stoechiometrique",
    );
  });
});
