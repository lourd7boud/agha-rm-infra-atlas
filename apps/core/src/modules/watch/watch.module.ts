import { join } from 'node:path';
import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Roles } from '../auth/auth.module';
import { TenderModule } from '../tender/tender.module';
import { WatchService } from './watch.service';
import {
  FixturePortalSource,
  HttpPortalSource,
  PORTAL_SOURCE,
  type PortalSource,
} from './watch.source';

const QUEUE_NAME = 'watch';
const WATCH_QUEUE = Symbol('WATCH_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

@Controller('watch')
export class WatchController {
  constructor(@Inject(WATCH_QUEUE) private readonly queue: Queue) {}

  /** Enqueue a Sentinel run (manual trigger; cron covers the schedule). */
  @Roles('admin-si', 'marches', 'direction')
  @Post('run')
  async run() {
    const job = await this.queue.add('run', { trigger: 'manual' });
    return { jobId: job.id, queue: QUEUE_NAME };
  }

  @Roles('admin-si', 'marches', 'direction')
  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`Job not found: ${id}`);
    return {
      id: job.id,
      state: await job.getState(),
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }
}

const portalSourceProvider = {
  provide: PORTAL_SOURCE,
  useFactory: (): PortalSource => {
    const logger = new Logger('WatchModule');
    if (process.env.WATCH_SOURCE === 'live' && process.env.WATCH_PMMP_URL) {
      logger.log(`Sentinel source: LIVE ${process.env.WATCH_PMMP_URL}`);
      return new HttpPortalSource(process.env.WATCH_PMMP_URL);
    }
    logger.warn(
      'Sentinel source: recorded fixture (set WATCH_SOURCE=live + WATCH_PMMP_URL for production)',
    );
    return new FixturePortalSource(
      join(process.cwd(), 'src/modules/watch/fixtures/pmmp-results.html'),
    );
  },
};

const watchQueueProvider = {
  provide: WATCH_QUEUE,
  useFactory: (): Queue =>
    new Queue(QUEUE_NAME, { connection: redisConnection() }),
};

@Module({
  imports: [TenderModule],
  controllers: [WatchController],
  providers: [portalSourceProvider, watchQueueProvider, WatchService],
})
export class WatchModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WatchModule');
  private worker: Worker | null = null;

  constructor(
    @Inject(WatchService) private readonly service: WatchService,
    @Inject(WATCH_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUE_NAME,
      async () => this.service.runOnce(),
      { connection: redisConnection() },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`watch job ${job?.id} failed: ${error.message}`),
    );

    const cron = process.env.WATCH_CRON;
    if (cron) {
      await this.queue.upsertJobScheduler('watch-schedule', { pattern: cron });
      this.logger.log(`Sentinel scheduled: ${cron}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
