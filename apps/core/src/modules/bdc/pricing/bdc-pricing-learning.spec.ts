import { describe, expect, test, vi } from "vitest";
import {
  BASELINE_PRICING_CALIBRATION,
  InMemoryBdcPricingRepository,
} from "./bdc-pricing.repository";
import {
  BdcPricingLearning,
  buildCalibrationCandidate,
  feedbackLearningWeight,
  type PricingLearningSample,
} from "./bdc-pricing-learning";

function sample(
  overrides: Partial<PricingLearningSample> = {},
): PricingLearningSample {
  return {
    id: "sample-1",
    category: "travaux",
    unit: "m2",
    region: "agadir",
    sourceTypes: ["web"],
    predictedCostHt: 100,
    proposedUnitPriceHt: 120,
    actualCostHt: 120,
    kind: "actual_cost",
    verified: true,
    observedAt: new Date("2026-07-19T00:00:00.000Z"),
    ...overrides,
  };
}

describe("pricing learning", () => {
  test("assigns no weight to unverified predictions and highest weight to actual cost", () => {
    expect(feedbackLearningWeight("actual_cost", false)).toBe(0);
    expect(feedbackLearningWeight("approved", true)).toBeGreaterThan(0);
    expect(feedbackLearningWeight("corrected", true)).toBeGreaterThan(
      feedbackLearningWeight("approved", true),
    );
    expect(feedbackLearningWeight("actual_cost", true)).toBe(1);
    expect(feedbackLearningWeight("won", true, null)).toBe(0);
    expect(feedbackLearningWeight("lost", true, null)).toBe(0);
  });

  test("decays stale evidence and requires 20 comparable samples for a segment", () => {
    const fresh = Array.from({ length: 19 }, (_, index) =>
      sample({ id: `fresh-${index}` }),
    );
    const insufficient = buildCalibrationCandidate(
      BASELINE_PRICING_CALIBRATION,
      fresh,
      new Date("2026-07-20T00:00:00.000Z"),
      20,
    );
    expect(insufficient.categoryFactors.travaux).toBe(1);

    const enough = buildCalibrationCandidate(
      BASELINE_PRICING_CALIBRATION,
      [...fresh, sample({ id: "fresh-20" })],
      new Date("2026-07-20T00:00:00.000Z"),
      20,
    );
    expect(enough.categoryFactors.travaux).toBeGreaterThan(1);
    expect(enough.sampleCount).toBe(20);

    const stale = buildCalibrationCandidate(
      BASELINE_PRICING_CALIBRATION,
      Array.from({ length: 20 }, (_, index) =>
        sample({
          id: `stale-${index}`,
          observedAt: new Date("2020-01-01T00:00:00.000Z"),
        }),
      ),
      new Date("2026-07-20T00:00:00.000Z"),
      20,
    );
    expect(stale.categoryFactors.travaux).toBeLessThan(
      enough.categoryFactors.travaux!,
    );
  });

  test("lowers repeated inaccurate source reliability", () => {
    const candidate = buildCalibrationCandidate(
      BASELINE_PRICING_CALIBRATION,
      Array.from({ length: 20 }, (_, index) =>
        sample({ id: `error-${index}`, predictedCostHt: 50, actualCostHt: 150 }),
      ),
      new Date("2026-07-20T00:00:00.000Z"),
      20,
    );
    expect(candidate.sourceReliability.web).toBeLessThan(
      BASELINE_PRICING_CALIBRATION.sourceReliability.web!,
    );
  });

  test("tracks verified win rate without using outcomes as cost evidence", () => {
    const candidate = buildCalibrationCandidate(
      BASELINE_PRICING_CALIBRATION,
      [
        ...Array.from({ length: 20 }, (_, index) => sample({ id: `cost-${index}` })),
        sample({ id: "won", kind: "won", winningAmountHtMad: 150 }),
        sample({ id: "lost", kind: "lost", winningAmountHtMad: 160 }),
      ],
      new Date("2026-07-20T00:00:00.000Z"),
      20,
    );
    expect(candidate.sampleCount).toBe(20);
    expect(candidate.winRatePct).toBe(50);
  });

  test("loads verified repository feedback through auditable evidence ids", async () => {
    const repository = new InMemoryBdcPricingRepository({
      now: () => new Date("2026-07-20T00:00:00.000Z"),
      id: (() => {
        let id = 0;
        return () => `repo-${++id}`;
      })(),
    });
    const run = await repository.createRun({
      avisId: "avis-1",
      idempotencyKey: "key-1",
      contentHash: "hash-1",
      actorId: "user-1",
      requestedMarkupPct: 15,
      calibrationVersion: "baseline-v1",
    });
    const [evidence] = await repository.upsertObservations([
      {
        designation: "Peinture intérieure",
        category: "travaux",
        unit: "m2",
        unitPriceHtMad: 100,
        region: "agadir",
        observedAt: "2026-07-19T00:00:00.000Z",
        sourceType: "facture",
        sourceRef: "FAC-1",
        sourceUrl: null,
        snapshotHash: "evidence-1",
        verified: true,
        reliability: 1,
        metadata: {},
      },
    ]);
    await repository.replaceDecisions(run.id, [
      {
        idx: 0,
        estimatedCostHt: 100,
        proposedUnitPriceHt: 150,
        rangeLowHt: 115,
        rangeHighHt: 155,
        markupPct: 50,
        confidence: "elevee",
        method: "reference_directe",
        sourceIds: [evidence!.id!],
        explanation: "Facture vérifiée",
        warnings: [],
        manualPriceLocked: false,
      },
    ]);
    await repository.recordFeedback({
      runId: run.id,
      lineIdx: 0,
      kind: "actual_cost",
      unitPriceHtMad: null,
      actualCostHtMad: 120,
      winningAmountHtMad: null,
      sourceRef: "FAC-FINALE",
      sourceUrl: null,
      verified: true,
      note: null,
    });
    const learning = new BdcPricingLearning(repository, {
      minSegmentSamples: 1,
      historyDays: 1_095,
    });
    const loaded = await learning.loadVerifiedSamples(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(loaded).toEqual([
      expect.objectContaining({
        category: "travaux",
        unit: "m2",
        sourceTypes: ["facture"],
        actualCostHt: 120,
      }),
    ]);
    await expect(
      learning.recalibrate(new Date("2026-07-20T00:00:00.000Z")),
    ).resolves.toMatchObject({ published: true });
  });

  test("publishes an immutable candidate only after protected replay passes", async () => {
    const repository = new InMemoryBdcPricingRepository({
      now: () => new Date("2026-07-20T00:00:00.000Z"),
      id: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
    });
    const learning = new BdcPricingLearning(repository, {
      minSegmentSamples: 20,
      historyDays: 1_095,
      loadSamples: async () =>
        Array.from({ length: 20 }, (_, index) =>
          sample({
            id: `ok-${index}`,
            predictedCostHt: 100,
            proposedUnitPriceHt: 150,
            actualCostHt: 120,
          }),
        ),
    });
    const publish = vi.spyOn(repository, "publishCalibration");
    const result = await learning.recalibrate(
      new Date("2026-07-20T00:00:00.000Z"),
    );
    expect(result.published).toBe(true);
    expect(result.calibration.version).not.toBe("baseline-v1");
    expect(publish).toHaveBeenCalledOnce();
  });

  test("rejects a candidate whose replay violates the realized 15 percent floor", async () => {
    const repository = new InMemoryBdcPricingRepository();
    const learning = new BdcPricingLearning(repository, {
      minSegmentSamples: 20,
      historyDays: 1_095,
      loadSamples: async () =>
        Array.from({ length: 20 }, (_, index) =>
          sample({
            id: `bad-${index}`,
            proposedUnitPriceHt: 100,
            actualCostHt: 120,
          }),
        ),
    });
    const result = await learning.recalibrate(
      new Date("2026-07-20T00:00:00.000Z"),
    );
    expect(result.published).toBe(false);
    expect(result.reason).toContain("protected_invariant");
    expect((await repository.getActiveCalibration()).version).toBe("baseline-v1");
  });
});
