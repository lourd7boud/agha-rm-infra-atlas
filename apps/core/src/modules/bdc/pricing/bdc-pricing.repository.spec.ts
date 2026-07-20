import { describe, expect, test } from "vitest";
import type { LinePricingDecision, PriceObservation } from "./bdc-pricing.types";
import { InMemoryBdcPricingRepository } from "./bdc-pricing.repository";

const decision = (idx: number, price: number): LinePricingDecision => ({
  idx,
  estimatedCostHt: 100,
  proposedUnitPriceHt: price,
  rangeLowHt: price,
  rangeHighHt: price,
  markupPct: price - 100,
  confidence: "moyenne",
  method: "decomposition",
  sourceIds: [],
  explanation: "test",
  warnings: [],
  manualPriceLocked: false,
});

const observation = (hash = "hash-1"): PriceObservation => ({
  designation: "Peinture 20 kg",
  category: "fournitures",
  unit: "u",
  unitPriceHtMad: 500,
  region: "Agadir",
  observedAt: "2026-07-20T00:00:00.000Z",
  sourceType: "facture",
  sourceRef: "FAC-1",
  sourceUrl: null,
  snapshotHash: hash,
  verified: true,
  reliability: 0.95,
  metadata: {},
});

describe("BDC pricing repository contract", () => {
  test("returns the newest run for an avis", async () => {
    let now = new Date("2026-07-20T10:00:00.000Z");
    const repository = new InMemoryBdcPricingRepository({ now: () => now });
    const first = await repository.createRun({
      avisId: "avis-1",
      idempotencyKey: "key-1",
      contentHash: "content-1",
      actorId: "user-1",
      requestedMarkupPct: 15,
      calibrationVersion: "baseline",
    });
    now = new Date("2026-07-20T11:00:00.000Z");
    const second = await repository.createRun({
      avisId: "avis-1",
      idempotencyKey: "key-2",
      contentHash: "content-1",
      actorId: "user-1",
      requestedMarkupPct: 15,
      calibrationVersion: "baseline",
    });

    expect((await repository.getLatestRun("avis-1"))?.id).toBe(second.id);
    expect((await repository.getRun(first.id))?.id).toBe(first.id);
  });

  test("reuses an idempotency key for the same avis", async () => {
    const repository = new InMemoryBdcPricingRepository();
    const input = {
      avisId: "avis-1",
      idempotencyKey: "stable-key",
      contentHash: "content-1",
      actorId: "user-1",
      requestedMarkupPct: 15,
      calibrationVersion: "baseline",
    };

    const first = await repository.createRun(input);
    const second = await repository.createRun(input);
    expect(second.id).toBe(first.id);
  });

  test("upserts evidence idempotently by snapshot hash", async () => {
    const repository = new InMemoryBdcPricingRepository();
    const [first] = await repository.upsertObservations([observation()]);
    const [second] = await repository.upsertObservations([
      { ...observation(), reliability: 0.8 },
    ]);

    expect(second?.id).toBe(first?.id);
    expect((await repository.findObservations({ limit: 10 }))).toHaveLength(1);
    expect((await repository.findObservations({ limit: 10 }))[0]?.reliability).toBe(0.8);
  });

  test("replaces line decisions atomically", async () => {
    const repository = new InMemoryBdcPricingRepository();
    const run = await repository.createRun({
      avisId: "avis-1",
      idempotencyKey: "key-1",
      contentHash: "content-1",
      actorId: "user-1",
      requestedMarkupPct: 15,
      calibrationVersion: "baseline",
    });
    await repository.replaceDecisions(run.id, [decision(0, 115)]);

    await expect(
      repository.replaceDecisions(run.id, [decision(1, 120), decision(1, 130)]),
    ).rejects.toThrow(/duplicate/i);
    expect(await repository.listDecisions(run.id)).toEqual([decision(0, 115)]);
  });

  test("excludes unverified feedback from the learning feed", async () => {
    const repository = new InMemoryBdcPricingRepository();
    await repository.recordFeedback({
      runId: "run-1",
      lineIdx: 0,
      kind: "corrected",
      unitPriceHtMad: 130,
      actualCostHtMad: null,
      winningAmountHtMad: null,
      sourceRef: null,
      sourceUrl: null,
      verified: false,
      note: null,
    });
    await repository.recordFeedback({
      runId: "run-1",
      lineIdx: 0,
      kind: "actual_cost",
      unitPriceHtMad: null,
      actualCostHtMad: 100,
      winningAmountHtMad: null,
      sourceRef: "FAC-2",
      sourceUrl: null,
      verified: true,
      note: null,
    });

    const feedback = await repository.listVerifiedFeedback(new Date(0));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.kind).toBe("actual_cost");
  });

  test("publishes immutable calibration versions and activates the latest", async () => {
    const repository = new InMemoryBdcPricingRepository();
    const baseline = await repository.getActiveCalibration();
    await repository.publishCalibration({
      ...baseline,
      version: "cal-2",
      createdAt: "2026-07-20T12:00:00.000Z",
      sampleCount: 25,
    });
    await expect(
      repository.publishCalibration({
        ...baseline,
        version: "cal-2",
        createdAt: "2026-07-20T13:00:00.000Z",
      }),
    ).rejects.toThrow(/immutable/i);

    expect((await repository.getActiveCalibration()).version).toBe("cal-2");
  });
});
