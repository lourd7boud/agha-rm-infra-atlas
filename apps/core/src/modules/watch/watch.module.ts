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
import { DelayedError, Queue, Worker } from 'bullmq';
import { getDb } from '../../db/client';
import { isPmmpUrl, nextPmmpOpening } from '../../lib/pmmp-hours';
import { Roles } from '../auth/auth.module';
import { TenderModule } from '../tender/tender.module';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { ExpertModule } from '../expert/expert.module';
import { DetailCrawlerService } from './detail.crawler';
import { ResultCrawlerService } from './result.crawler';
import { ExtraitPvCrawlerService } from './pv.crawler';
import { SuiviCrawlerService } from './suivi.crawler';
import { NoticeArchiveService } from './notice-archive';
import { NoticeInterpretService } from './notice-interpret';
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
  type WatchRunSummary,
} from './watch.service';
import { buildWatchHealth, nextScanDelay } from './watch-health';
import { WatchAuditCapture, type WatchAudit } from './watch-audit';
import { PortalPausedError, PortalRequestGate } from './portal-request-gate';
import {
  FixturePortalSource,
  HttpPortalSource,
  PORTAL_SOURCE,
  PradoPortalSource,
  type HttpPortalOptions,
  type PortalSource,
} from './watch.source';

/** Bounded full active-catalogue walk: up to 10,000 records at 50/page. */
const DEFAULT_MAX_PAGES = 200;
/** Default polite delay between page fetches. */
const DEFAULT_PAGE_DELAY_MS = 800;

/** Parses an env integer, falling back to a default on NaN/below-min values. */
function intEnv(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

const QUEUE_NAME = 'watch';
const WATCH_QUEUE = Symbol('WATCH_QUEUE');
const ENRICH_QUEUE = Symbol('WATCH_ENRICH_QUEUE');
const COOLDOWN_KEY = 'atlas:watch:portal-cooldown';
type WatchJobResult = WatchRunSummary & { audit?: WatchAudit };

function livePortalUrl(): string | undefined {
  return process.env.WATCH_SOURCE === 'live' ? process.env.WATCH_PMMP_URL || undefined : undefined;
}

function scheduledReopen(now = new Date()): Date | null {
  return isPmmpUrl(livePortalUrl()) ? nextPmmpOpening(now) : null;
}

function scheduledDelay(delay: number, now = new Date()): number {
  const candidate = new Date(now.getTime() + delay);
  const reopen = scheduledReopen(now) ?? scheduledReopen(candidate);
  return reopen ? reopen.getTime() - now.getTime() : delay;
}

function assertPortalOpen(): void {
  if (scheduledReopen()) throw new PortalPausedError('PMMP closed for the night');
}

async function cooldownRemaining(redis: Awaited<Queue['client']>): Promise<number> {
  const until = Number(await redis.get(COOLDOWN_KEY));
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
}

async function setCooldown(redis: Awaited<Queue['client']>, status: 'blocked' | 'failed'): Promise<void> {
  const delay = nextScanDelay(status, 0);
  await redis.set(COOLDOWN_KEY, String(Date.now() + delay), { PX: delay });
}

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

  @Roles('admin-si', 'marches', 'direction')
  @Get('status')
  async status() {
    const now = new Date();
    const portalReopensAt = scheduledReopen(now);
    const [coverage, active, completed, failed, pending, redis] = await Promise.all([
      this.snapshots.coverage(), this.queue.getJobs(['active'], 0, 0),
      this.queue.getJobs(['completed'], 0, portalReopensAt ? 5 : 0),
      this.queue.getJobs(['failed'], 0, 0), this.queue.getJobs(['waiting', 'delayed'], 0, 0),
      this.queue.client,
    ]);
    const lastRead = portalReopensAt
      ? completed.find((job) => (job.returnvalue as WatchJobResult | undefined)?.pagesFetched)
      : undefined;
    const lastCompleted = lastRead ?? completed[0];
    const failedLatest = !lastRead && (failed[0]?.finishedOn ?? 0) > (lastCompleted?.finishedOn ?? 0);
    const latest = failedLatest ? failed[0] : lastCompleted;
    const job = active[0] ?? latest;
    const summary = (active[0] ? active[0].progress : job?.returnvalue) as WatchRunSummary | undefined;
    const previous = lastCompleted?.returnvalue as WatchJobResult | undefined;
    const nextPending = pending[0];
    const cooldown = await cooldownRemaining(redis);
    const pendingAt = nextPending && nextPending.delay > 0
      ? Math.max(now.getTime(), nextPending.timestamp + nextPending.delay)
      : null;
    const nextRunAt = portalReopensAt && process.env.WATCH_CONTINUOUS === 'true'
      ? new Date(Math.max(portalReopensAt.getTime(), pendingAt ?? 0, now.getTime() + cooldown))
      : !active.length && pendingAt !== null && (!portalReopensAt || pendingAt >= portalReopensAt.getTime())
        ? new Date(pendingAt)
        : null;
    const health = buildWatchHealth(coverage.find((c) => c.source === 'watch') ?? null,
      failedLatest ? { status: 'failed' } : previous?.status ? previous : null);
    return {
      ...health, state: portalReopensAt ? 'closed' : cooldown > 0 ? 'blocked' : active.length ? 'running' : health.state,
      sourceMode: livePortalUrl() ? 'live' : 'fixture',
      portalReopensAt,
      cooldownUntil: cooldown > 0 ? new Date(now.getTime() + cooldown) : null,
      lastAuditRunId: previous?.audit ? lastCompleted?.id ?? null : null,
      nextRunAt,
      run: job ? {
        id: job.id, startedAt: job.processedOn ? new Date(job.processedOn) : null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
        status: summary?.status ?? null, stopReason: summary?.stopReason ?? null,
        portalTotal: summary?.portalTotal ?? null, uniqueSeen: summary?.uniqueSeen ?? null,
        pagesFetched: summary?.pagesFetched ?? 0, inserted: summary?.inserted ?? 0,
        healed: summary?.healed ?? 0, skippedRows: summary?.skippedRows ?? 0, errors: summary?.errors ?? 0,
      } : null,
    };
  }

  /** Enqueue a Sentinel run (manual trigger; cron covers the schedule). */
  @Roles('admin-si', 'marches', 'direction')
  @Post('run')
  async run() {
    const portalReopensAt = scheduledReopen();
    if (portalReopensAt) return { queued: false, portalReopensAt };
    const cooldown = await cooldownRemaining(await this.queue.client);
    if (cooldown > 0) return { queued: false, cooldownUntil: new Date(Date.now() + cooldown) };
    const [existing] = await this.queue.getJobs(['active', 'waiting', 'delayed'], 0, 0);
    if (existing) {
      if (await existing.getState() === 'delayed') await existing.changeDelay(0);
      return { queued: true, jobId: existing.id, queue: QUEUE_NAME };
    }
    const job = await this.queue.add('run', { trigger: 'manual' }, { removeOnComplete: 50, removeOnFail: 20 });
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
    const portalReopensAt = scheduledReopen();
    if (portalReopensAt) return { queued: false, portalReopensAt };
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
  async harvestResults(
    @Query('max') max?: string,
    @Query('pages') pages?: string,
  ) {
    const portalReopensAt = scheduledReopen();
    if (portalReopensAt) return { queued: false, portalReopensAt };
    const parsed = Number(max);
    const maxResults =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300) : 8;
    const parsedPages = Number(pages);
    const maxPages =
      Number.isFinite(parsedPages) && parsedPages > 0
        ? Math.min(parsedPages, 60)
        : 1;
    return this.resultCrawler.crawlOnce({ maxResults, maxPages });
  }

  /**
   * Stage-3b PV crawl: mine "extrait de procès-verbal" (annonceType=5) — the
   * full bidder field + administrative estimation. Each PV stores every
   * soumissionnaire (winner + écartés) and feeds the rebate calibration.
   * `?max=` caps PVs (default 8; each costs one vision call).
   */
  @Roles('admin-si', 'marches', 'direction')
  @Post('harvest-pv')
  async harvestPv(@Query('max') max?: string, @Query('pages') pages?: string) {
    const portalReopensAt = scheduledReopen();
    if (portalReopensAt) return { queued: false, portalReopensAt };
    const parsed = Number(max);
    const maxPv = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300) : 8;
    const parsedPages = Number(pages);
    const maxPages =
      Number.isFinite(parsedPages) && parsedPages > 0
        ? Math.min(parsedPages, 60)
        : 1;
    return this.pvCrawler.crawlOnce({ maxPv, maxPages });
  }

  @Roles('admin-si', 'marches', 'direction')
  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`Job not found: ${id}`);
    const result = job.returnvalue as WatchJobResult | null | undefined;
    const { audit, ...summary } = result ?? {};
    return {
      id: job.id,
      state: await job.getState(),
      result: result ? summary : null,
      auditAvailable: Boolean(audit),
      failedReason: job.failedReason ?? null,
    };
  }

  @Roles('admin-si', 'marches', 'direction')
  @Get('runs/:id/audit')
  async getRunAudit(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    const result = job?.returnvalue as WatchJobResult | null | undefined;
    if (!job || !result?.audit) throw new NotFoundException('No audit for this run');
    const { audit, ...summary } = result;
    return {
      id: job.id, startedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null, summary, audit,
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
  inject: [PortalRequestGate],
  useFactory: (gate: PortalRequestGate): PortalSource => {
    const logger = new Logger('WatchModule');
    const url = livePortalUrl();
    if (url) {
      const fetchImpl: typeof fetch = (...args) => { assertPortalOpen(); return fetch(...args); };
      // marchespublics.gov.ma (Atexo MPE) paginates via PRADO POST, not a GET
      // param — WATCH_PORTAL_MODE=prado drives the stateful next-page crawl.
      if (process.env.WATCH_PORTAL_MODE === 'prado') {
        logger.log(`Sentinel source: LIVE PRADO ${url}`);
        const source = new PradoPortalSource(url, { pageSize: intEnv(process.env.WATCH_PAGE_SIZE, 50, 1), fetchImpl });
        return { fetch: (page) => gate.run(() => source.fetch(page)) };
      }
      logger.log(`Sentinel source: LIVE ${url}`);
      const source = new HttpPortalSource(url, { ...paginationOptions(), fetchImpl });
      return { fetch: (page) => gate.run(() => source.fetch(page)) };
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
const enrichQueueProvider = {
  provide: ENRICH_QUEUE,
  useFactory: () => new Queue('watch-enrichment', { connection: redisConnection() }),
};
const portalRequestGateProvider = {
  provide: PortalRequestGate,
  inject: [WATCH_QUEUE],
  useFactory: (queue: Queue) => new PortalRequestGate({
    delayMs: DEFAULT_PAGE_DELAY_MS,
    shouldPause: async () => Boolean(scheduledReopen()) || await cooldownRemaining(await queue.client) > 0,
    onBlocked: async () => { if (!scheduledReopen()) await setCooldown(await queue.client, 'blocked'); },
  }),
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
  imports: [TenderModule, BrainModule, IntelModule, ExpertModule],
  controllers: [WatchController],
  providers: [
    portalSourceProvider,
    watchQueueProvider,
    enrichQueueProvider,
    portalRequestGateProvider,
    watchOptionsProvider,
    snapshotRepositoryProvider,
    WatchService,
    DetailCrawlerService,
    ResultCrawlerService,
    ExtraitPvCrawlerService,
    SuiviCrawlerService,
    NoticeArchiveService,
    NoticeInterpretService,
  ],
  exports: [snapshotRepositoryProvider],
})
export class WatchModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WatchModule');
  private worker: Worker | null = null;
  private enrichmentWorker: Worker | null = null;
  /** Set on destroy so the continuous loop's self-reschedule stops cleanly. */
  private shuttingDown = false;

  constructor(
    @Inject(WatchService) private readonly service: WatchService,
    @Inject(WATCH_QUEUE) private readonly queue: Queue,
    @Inject(ENRICH_QUEUE) private readonly enrichmentQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // datao-parity: only the dedicated worker container runs the BullMQ
    // consumer + Sentinel scheduler. The API container serves HTTP requests
    // only, so /tenders SSR is never blocked by an in-flight sweep's PDF
    // rendering + LLM bursts. datao isolates extraction on separate infra
    // (Vercel Functions / dedicated worker); here it's a second container
    // (`worker` in docker-compose.apps.yml) that is the ONLY process with
    // WATCH_WORKER_ENABLED=true. The API-only process (core) sees this env
    // absent/false and exits onModuleInit early, keeping its event loop free.
    if (process.env.WATCH_WORKER_ENABLED !== 'true') {
      this.logger.log('Sentinel worker DISABLED — this is an API-only process');
      return;
    }
    // Discovery only performs asynchronous page reads and bounded DB writes.
    // CPU-heavy dossier work has its own queue/lease, so a crashed discovery
    // worker can be recovered promptly without a ninety-minute stale lock.
    this.worker = new Worker(
      QUEUE_NAME,
      async (job, token) => {
        const reopen = scheduledReopen();
        if (reopen && !job.repeatJobKey) {
          await job.moveToDelayed(reopen.getTime(), token);
          throw new DelayedError();
        }
        if (reopen) {
          // Keep the last real run in history when a legacy cron tick falls at night.
          job.opts.removeOnComplete = true;
          return { skipped: 'scheduled_closure' };
        }
        const redis = await this.queue.client;
        const cooldown = await cooldownRemaining(redis);
        if (cooldown > 0) return {
          status: 'blocked', stopReason: 'blocked', uniqueSeen: 0, fetched: 0,
          inserted: 0, duplicates: 0, healed: 0, sourceUrlBackfilled: 0,
          skippedRows: 0, errors: 0, pagesFetched: 0,
        } satisfies WatchRunSummary;
        const portalUrl = livePortalUrl();
        const audit = portalUrl ? new WatchAuditCapture(portalUrl) : undefined;
        const summary = await this.service.runOnce({ discoveryOnly: true, progress: (p) => job.updateProgress(p), audit,
          scheduledReopen,
          shouldPause: async () => await cooldownRemaining(redis) > 0,
          onBlocked: () => setCooldown(redis, 'blocked'),
        });
        if (summary.stopReason === 'scheduled_closure' && summary.pagesFetched === 0) {
          job.opts.removeOnComplete = true;
        }
        if (summary.status === 'failed') await setCooldown(redis, 'failed');
        return audit ? { ...summary, audit: audit.finish() } satisfies WatchJobResult : summary;
      },
      {
        connection: redisConnection(),
        lockDuration: 2 * 60_000,
        stalledInterval: 60_000,
        maxStalledCount: 1,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`watch job ${job?.id} failed: ${error.message}`),
    );
    this.enrichmentWorker = new Worker('watch-enrichment', async () => {
      if (scheduledReopen()) return { skipped: 'scheduled_closure' };
      const redis = await this.queue.client;
      if (await cooldownRemaining(redis) > 0) return { skipped: 'portal_cooldown' };
      const result = await this.service.enrichOnce({
        shouldPause: async () => Boolean(scheduledReopen()) || await cooldownRemaining(redis) > 0,
        onBlocked: async () => { if (!scheduledReopen()) await setCooldown(redis, 'blocked'); },
      });
      return result;
    }, { connection: redisConnection(), lockDuration: 90 * 60_000, concurrency: 1 });
    this.enrichmentWorker.on('failed', (_job, error) => this.logger.error(`metadata refresh failed: ${error.message}`));
    await this.enrichmentQueue.upsertJobScheduler('metadata-refresh', { every: 15 * 60_000 }, {
      name: 'enrich', opts: { removeOnComplete: 20, removeOnFail: 20 },
    });

    // Two scheduling modes, mutually exclusive — continuous wins if set:
    // Continuous discovery persists its next delayed job in Redis. Status-aware
    // minimum delays apply even when the legacy environment requests 5 seconds.
    //   WATCH_CRON=… → legacy cron schedule (idle between runs).
    if (process.env.WATCH_CONTINUOUS === 'true') {
      const loopDelay = intEnv(process.env.WATCH_LOOP_DELAY_MS, 5_000, 0);
      this.logger.log(
        `Sentinel: continuous mode (loop, ${loopDelay}ms breather between sweeps)`,
      );
      const scheduleNext = async (status: WatchRunSummary['status']) => {
        try {
          if (this.shuttingDown) return;
          const pending = await this.queue.getJobs(['waiting', 'delayed'], 0, 0);
          if (pending.length) return;
          await this.queue.add(
              'sentinel-sweep',
              {},
              { delay: scheduledDelay(nextScanDelay(status, loopDelay)), removeOnComplete: 50, removeOnFail: 20 },
            );
        } catch (error) {
          this.logger.error(`continuous re-enqueue failed: ${(error as Error).message}`);
        }
      };
      this.worker.on('completed', (_job, result: WatchRunSummary) => { void scheduleNext(result.status); });
      this.worker.on('failed', () => {
        void scheduleNext('failed');
      });
      // Kick off the first sweep — subsequent ones chain off `completed`.
      const existing = await this.queue.getJobs(['waiting', 'active', 'delayed'], 0, 0);
      if (existing.length === 0) await this.queue.add(
        'sentinel-sweep',
        {},
        { delay: scheduledDelay(0), removeOnComplete: 50, removeOnFail: 20 },
      );
      return;
    }

    const cron = process.env.WATCH_CRON;
    if (cron) {
      await this.queue.upsertJobScheduler('watch-schedule', { pattern: cron }, {
        name: 'sentinel-sweep', opts: { removeOnComplete: 50, removeOnFail: 20 },
      });
      this.logger.log(`Sentinel scheduled: ${cron}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await this.worker?.close();
    await this.enrichmentWorker?.close();
    await this.queue.close();
    await this.enrichmentQueue.close();
  }
}
