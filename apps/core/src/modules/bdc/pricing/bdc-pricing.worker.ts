import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import {
  BDC_PRICING_QUEUE,
  BdcPricingService,
} from "./bdc-pricing.service";

export const BDC_PRICING_QUEUE_NAME = "bdc-pricing";

export function bdcPricingRedisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

export async function dispatchBdcPricingJob(
  job: Job,
  pricing: BdcPricingService,
) {
  if (job.name !== "price") {
    throw new Error(`Unsupported BDC pricing job: ${job.name}`);
  }
  const runId =
    typeof job.data?.runId === "string" ? job.data.runId.trim() : "";
  if (!runId) throw new Error("BDC pricing job requires runId");
  return pricing.run(runId);
}

export const bdcPricingQueueProvider = {
  provide: BDC_PRICING_QUEUE,
  useFactory: () =>
    new Queue(BDC_PRICING_QUEUE_NAME, {
      connection: bdcPricingRedisConnection(),
    }),
};

@Injectable()
export class BdcPricingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BdcPricingWorker.name);
  private worker: Worker | null = null;

  constructor(
    @Inject(BdcPricingService)
    private readonly pricing: BdcPricingService,
    @Inject(BDC_PRICING_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WATCH_WORKER_ENABLED !== "true") {
      this.logger.log("BDC pricing worker DISABLED — API-only process");
      return;
    }
    this.worker = new Worker(
      BDC_PRICING_QUEUE_NAME,
      (job) => dispatchBdcPricingJob(job, this.pricing),
      {
        connection: bdcPricingRedisConnection(),
        lockDuration: 20 * 60 * 1_000,
        concurrency: Math.max(
          1,
          Math.min(4, Number(process.env.BDC_PRICING_CONCURRENCY) || 1),
        ),
      },
    );
    this.worker.on("failed", (job, error) =>
      this.logger.error(
        `BDC pricing job ${job?.id ?? "unknown"} failed: ${error.message}`,
      ),
    );
    this.logger.log("BDC pricing worker active");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
