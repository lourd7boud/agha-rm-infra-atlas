import type { Job, Queue } from "bullmq";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BdcPricingService } from "./bdc-pricing.service";
import type { BdcPricingLearning } from "./bdc-pricing-learning";
import {
  BdcPricingWorker,
  dispatchBdcPricingJob,
  isBdcPricingLearningEnabled,
} from "./bdc-pricing.worker";

afterEach(() => {
  delete process.env.WATCH_WORKER_ENABLED;
});

describe("BDC pricing worker", () => {
  test("supports an explicit emergency switch for scheduled learning", () => {
    expect(isBdcPricingLearningEnabled(undefined)).toBe(true);
    expect(isBdcPricingLearningEnabled("true")).toBe(true);
    expect(isBdcPricingLearningEnabled("false")).toBe(false);
    expect(isBdcPricingLearningEnabled(" FALSE ")).toBe(false);
  });

  test("dispatches a price job to the idempotent run orchestrator", async () => {
    const service = { run: vi.fn(async () => ({ status: "completed" })) };
    await expect(
      dispatchBdcPricingJob(
        { name: "price", data: { runId: "run-1" } } as Job,
        service as unknown as BdcPricingService,
      ),
    ).resolves.toMatchObject({ status: "completed" });
    expect(service.run).toHaveBeenCalledWith("run-1");
  });

  test("rejects malformed or unsupported jobs without touching a run", async () => {
    const service = { run: vi.fn() };
    await expect(
      dispatchBdcPricingJob(
        { name: "price", data: {} } as Job,
        service as unknown as BdcPricingService,
      ),
    ).rejects.toThrow("runId");
    await expect(
      dispatchBdcPricingJob(
        { name: "unknown", data: { runId: "run-1" } } as Job,
        service as unknown as BdcPricingService,
      ),
    ).rejects.toThrow("Unsupported");
    expect(service.run).not.toHaveBeenCalled();
  });

  test("dispatches the scheduled learning job with its immutable as-of date", async () => {
    const service = { run: vi.fn() } as unknown as BdcPricingService;
    const learning = {
      recalibrate: vi.fn(async () => ({ published: true })),
    } as unknown as BdcPricingLearning;
    await dispatchBdcPricingJob(
      {
        name: "learn",
        data: { asOf: "2026-07-20T02:30:00.000Z" },
      } as Job,
      service,
      learning,
    );
    expect(learning.recalibrate).toHaveBeenCalledWith(
      new Date("2026-07-20T02:30:00.000Z"),
    );
  });

  test("does not open a worker in API-only mode and closes its queue cleanly", async () => {
    process.env.WATCH_WORKER_ENABLED = "false";
    const queue = { close: vi.fn() } as unknown as Queue;
    const service = { run: vi.fn() } as unknown as BdcPricingService;
    const learning = { recalibrate: vi.fn() } as unknown as BdcPricingLearning;
    const worker = new BdcPricingWorker(service, queue, learning);
    await worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
