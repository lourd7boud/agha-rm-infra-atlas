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
  Query,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { TenderModule } from '../tender/tender.module';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { DetailCrawlerService } from './detail.crawler';
import { ResultCrawlerService } from './result.crawler';
import { ExtraitPvCrawlerService } from './pv.crawler';
import {
  DrizzleSnapshotRepository,
  InMemorySnapshotRepository,
  SNAPSHOT_REPOSITORY,
  type SnapshotRepository,
} from './snapshot.repository';
import {
  WATCH_OPTIONS,
  WatchService,
  type WatchRunOptions,
} from './watch.service';
import {
  FixturePortalSource,
  HttpPortalSource,
  PORTAL_SOURCE,
  PradoPortalSource,
  type HttpPortalOptions,
  type PortalSource,
} from './watch.source';

/** Default ceiling on pages walked per run; ~25 pages covers a full day. */
const DEFAULT_MAX_PAGES = 25;
/** Default polite delay between page fetches. */
const DEFAULT_PAGE_DELAY_MS = 800;

/** Parses an env integer, falling back to a default on NaN/below-min values. */
function intEnv(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

const QUEUE_NAME = 'watch';
const WATCH_QUEUE = Symbol('WATCH_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

@Controller('watch')
export class WatchController {
  constructor(
    @Inject(WATCH_QUEUE) private readonly queue: Queue,
    @Inject(SNAPSHOT_REPOSITORY)
    private readonly snapshots: SnapshotRepository,
    @Inject(DetailCrawlerService)
    private readonly crawler: DetailCrawlerService,
    @Inject(ResultCrawlerService)
    private readonly resultCrawler: ResultCrawlerService,
    @Inject(ExtraitPvCrawlerService)
    private readonly pvCrawler: ExtraitPvCrawlerService,
  ) {}

  /** Live-portal coverage report: fetches, changes, items per source. */
  @Roles('admin-si', 'marches', 'direction')
  @Get('coverage')
  async coverage() {
    return this.snapshots.coverage();
  }

  /** Enqueue a Sentinel run (manual trigger; cron covers the schedule). */
  @Roles('admin-si', 'marches', 'direction')
  @Post('run')
  async run() {
    const job = await this.queue.add('run', { trigger: 'manual' });
    return { jobId: job.id, queue: QUEUE_NAME };
  }

  /**
   * Stage-2 detail crawl: enrich detected tenders from their consultation
   * detail pages (caution provisoire, category, detail URL; estimation when
   * published). Bounded + polite. `?max=` caps the detail fetches (default 40).
   */
  @Roles('admin-si', 'marches', 'direction')
  @Post('enrich-details')
  async enrichDetails(@Query('max') max?: string) {
    const parsed = Number(max);
    const maxDetails =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 40;
    return this.crawler.crawlOnce({ maxDetails });
  }

  /**
   * Stage-3 result crawl: mine published "avis de résultat définitif" — submit
   * the result search, read each scanned notice with a vision LLM, and store the
   * winner + amount in the competitor map. `?max=` caps notices (default 8;
   * each notice costs one vision call).
   */
  @Roles('admin-si', 'marches', 'direction')
  @Post('harvest-results')
  async harvestResults(@Query('max') max?: string) {
    const parsed = Number(max);
    const maxResults =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 8;
    return this.resultCrawler.crawlOnce({ maxResults });
  }

  /**
   * Stage-3b PV crawl: mine "extrait de procès-verbal" (annonceType=5) — the
   * full bidder field + administrative estimation. Each PV stores every
   * soumissionnaire (winner + écartés) and feeds the rebate calibration.
   * `?max=` caps PVs (default 8; each costs one vision call).
   */
  @Roles('admin-si', 'marches', 'direction')
  @Post('harvest-pv')
  async harvestPv(@Query('max') max?: string) {
    const parsed = Number(max);
    const maxPv = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 8;
    return this.pvCrawler.crawlOnce({ maxPv });
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

/** Reads the optional Atexo pagination knobs from the environment. */
function paginationOptions(): HttpPortalOptions {
  const logger = new Logger('WatchModule');
  const firstPageIndex = Number(process.env.WATCH_FIRST_PAGE_INDEX);
  const pageSize = Number(process.env.WATCH_PAGE_SIZE);
  if (process.env.WATCH_FIRST_PAGE_INDEX && !Number.isInteger(firstPageIndex)) {
    logger.warn('WATCH_FIRST_PAGE_INDEX is not an integer — ignored (default 1)');
  }
  if (process.env.WATCH_PAGE_SIZE && !Number.isInteger(pageSize)) {
    logger.warn('WATCH_PAGE_SIZE is not an integer — ignored');
  }
  const hasPageSize =
    Boolean(process.env.WATCH_PAGE_SIZE_PARAM) &&
    Number.isInteger(pageSize) &&
    pageSize > 0;
  return {
    ...(process.env.WATCH_PAGE_PARAM
      ? { pageParam: process.env.WATCH_PAGE_PARAM }
      : {}),
    ...(Number.isInteger(firstPageIndex) ? { firstPageIndex } : {}),
    ...(hasPageSize
      ? { pageSizeParam: process.env.WATCH_PAGE_SIZE_PARAM, pageSize }
      : {}),
  };
}

const portalSourceProvider = {
  provide: PORTAL_SOURCE,
  useFactory: (): PortalSource => {
    const logger = new Logger('WatchModule');
    const url = process.env.WATCH_PMMP_URL;
    if (process.env.WATCH_SOURCE === 'live' && url) {
      // marchespublics.gov.ma (Atexo MPE) paginates via PRADO POST, not a GET
      // param — WATCH_PORTAL_MODE=prado drives the stateful next-page crawl.
      if (process.env.WATCH_PORTAL_MODE === 'prado') {
        logger.log(`Sentinel source: LIVE PRADO ${url}`);
        return new PradoPortalSource(url);
      }
      logger.log(`Sentinel source: LIVE ${url}`);
      return new HttpPortalSource(url, paginationOptions());
    }
    logger.warn(
      'Sentinel source: recorded fixture (set WATCH_SOURCE=live + WATCH_PMMP_URL for production)',
    );
    return new FixturePortalSource(
      join(process.cwd(), 'src/modules/watch/fixtures/pmmp-results.html'),
    );
  },
};

const watchOptionsProvider = {
  provide: WATCH_OPTIONS,
  useFactory: (): WatchRunOptions => ({
    maxPages: intEnv(process.env.WATCH_MAX_PAGES, DEFAULT_MAX_PAGES, 1),
    delayMs: intEnv(process.env.WATCH_PAGE_DELAY_MS, DEFAULT_PAGE_DELAY_MS, 0),
  }),
};

const watchQueueProvider = {
  provide: WATCH_QUEUE,
  useFactory: (): Queue =>
    new Queue(QUEUE_NAME, { connection: redisConnection() }),
};

const snapshotRepositoryProvider = {
  provide: SNAPSHOT_REPOSITORY,
  useFactory: (): SnapshotRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleSnapshotRepository(getDb(url));
    new Logger('WatchModule').warn(
      'DATABASE_URL not set — snapshots use a non-persistent in-memory repository',
    );
    return new InMemorySnapshotRepository();
  },
};

@Module({
  imports: [TenderModule, BrainModule, IntelModule],
  controllers: [WatchController],
  providers: [
    portalSourceProvider,
    watchQueueProvider,
    watchOptionsProvider,
    snapshotRepositoryProvider,
    WatchService,
    DetailCrawlerService,
    ResultCrawlerService,
    ExtraitPvCrawlerService,
  ],
  exports: [snapshotRepositoryProvider],
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
