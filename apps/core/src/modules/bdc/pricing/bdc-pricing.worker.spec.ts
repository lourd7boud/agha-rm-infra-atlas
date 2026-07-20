import type { Job, Queue } from "bullmq";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BdcPricingService } from "./bdc-pricing.service";
import {
  BdcPricingWorker,
  dispatchBdcPricingJob,
} from "./bdc-pricing.worker";

afterEach(() => {
  delete process.env.WATCH_WORKER_ENABLED;
});

describe("BDC pricing worker", () => {
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

  test("does not open a worker in API-only mode and closes its queue cleanly", async () => {
    process.env.WATCH_WORKER_ENABLED = "false";
    const queue = { close: vi.fn() } as unknown as Queue;
    const service = { run: vi.fn() } as unknown as BdcPricingService;
    const worker = new BdcPricingWorker(service, queue);
    await worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
