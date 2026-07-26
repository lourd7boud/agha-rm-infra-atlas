import { describe, expect, test } from "vitest";
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

    const result = await estimator.estimate([line]);

    expect(result.get(0)).toMatchObject({
      unitCostHtMad: 10_000,
      lowHtMad: 10_000,
      highHtMad: 10_000,
      components: [
        {
          label: "expertise laboratoire",
          costHtMad: 10_000,
          sourceIds: [],
        },
      ],
    });
    expect(result.get(0)?.assumptions).toContain(
      "ia:estimation_conservative_sans_preuve_verifiee",
    );
    expect(llm.requests[0]?.system).toContain("N'invente ni source");
  });

  test("does nothing when no LLM is configured", async () => {
    expect(await new BdcAiEstimator(null).estimate([line])).toEqual(new Map());
  });
});
