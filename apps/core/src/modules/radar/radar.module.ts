// Module Radar proactif (/radar) — l'agent qui score les marchés en cours et
// pousse chaque jour le top des opportunités. Deux cadences sur une file
// BullMQ: 'radar-scan' (horaire) et 'radar-digest' (quotidien), gérées par le
// SEUL worker container (gate WATCH_WORKER_ENABLED). Routes /api/radar/*.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import {
  DrizzleOutboxRepository,
  InMemoryOutboxRepository,
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '../digest/outbox.repository';
import { createTransportFromEnv, DELIVERY_TRANSPORT } from '../digest/transport';
import { RadarService } from './radar.service';
import {
  DrizzleRadarRepository,
  RADAR_REPOSITORY,
  unavailableRadarRepository,
  type RadarRepository,
} from './radar.repository';

const MARCHES_ROLES = ['direction', 'marches', 'admin-si'] as const;
const RADAR_QUEUE_NAME = 'radar';
const RADAR_QUEUE = Symbol('RADAR_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

const statutSchema = z.object({
  statut: z.enum(['nouveau', 'vu', 'poursuivi', 'ecarte']),
});

@Controller('radar')
export class RadarController {
  constructor(
    @Inject(RADAR_REPOSITORY) private readonly repo: RadarRepository,
    @Inject(RadarService) private readonly radar: RadarService,
  ) {}

  /** Les opportunités scorées (marchés en cours), meilleures d'abord. */
  @Get('candidates')
  async candidates(
    @Query('statut') statut?: string,
    @Query('minScore') minScoreStr?: string,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitStr) || 20));
    const minScore = minScoreStr != null && minScoreStr !== '' ? Number(minScoreStr) : undefined;
    const [{ items, total }, stats] = await Promise.all([
      this.repo.listCandidates({
        statut: statut || undefined,
        minScore: Number.isFinite(minScore) ? minScore : undefined,
        search: search || undefined,
        page,
        limit,
      }),
      this.repo.stats(),
    ]);
    return { items, total, page, limit, stats };
  }

  /** Relance manuelle du scoring (le cron horaire le fait tout seul). */
  @Roles(...MARCHES_ROLES)
  @Post('scan')
  async scan() {
    return this.radar.runScan();
  }

  /** Compose et envoie le brief top-opportunités maintenant (audit outbox). */
  @Roles(...MARCHES_ROLES)
  @Post('dispatch')
  async dispatch() {
    return this.radar.dispatchDigest();
  }

  /** L'opérateur poursuit ou écarte une opportunité. */
  @Roles(...MARCHES_ROLES)
  @Patch('candidates/:tenderId/statut')
  async setStatut(@Param('tenderId') tenderId: string, @Body() body: unknown) {
    const parsed = statutSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ok = await this.repo.setStatut(tenderId, parsed.data.statut);
    if (!ok) throw new NotFoundException('Candidat introuvable');
    return { ok: true, statut: parsed.data.statut };
  }
}

const radarRepositoryProvider = {
  provide: RADAR_REPOSITORY,
  useFactory: (): RadarRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleRadarRepository(getDb(url));
    new Logger('RadarModule').warn('DATABASE_URL not set — RadarRepository unavailable');
    return unavailableRadarRepository<RadarRepository>('RadarRepository');
  },
};

// Outbox + transport: mêmes fabriques que le digest (classes réutilisées) —
// le brief radar voyage par le canal partagé (console aujourd'hui, SMTP demain).
const outboxRepositoryProvider = {
  provide: OUTBOX_REPOSITORY,
  useFactory: (): OutboxRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleOutboxRepository(getDb(url));
    return new InMemoryOutboxRepository();
  },
};

const transportProvider = {
  provide: DELIVERY_TRANSPORT,
  useFactory: createTransportFromEnv,
};

const radarQueueProvider = {
  provide: RADAR_QUEUE,
  useFactory: () => new Queue(RADAR_QUEUE_NAME, { connection: redisConnection() }),
};

@Module({
  controllers: [RadarController],
  providers: [
    RadarService,
    radarRepositoryProvider,
    outboxRepositoryProvider,
    transportProvider,
    radarQueueProvider,
  ],
})
export class RadarModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RadarModule');
  private worker: Worker | null = null;

  constructor(
    @Inject(RadarService) private readonly radar: RadarService,
    @Inject(RADAR_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Seul le worker container exécute la file (comme la Sentinelle/le digest);
    // l'API sort tôt pour ne jamais entrer en concurrence avec le SSR.
    if (process.env.WATCH_WORKER_ENABLED !== 'true') {
      this.logger.log('Radar worker DISABLED — this is an API-only process');
      return;
    }
    const scanCron = process.env.RADAR_CRON ?? '0 * * * *'; // horaire par défaut
    const digestCron = process.env.RADAR_DIGEST_CRON ?? '0 7 * * *'; // 07:00 par défaut

    // Une file, deux jobs récurrents distingués par leur nom.
    this.worker = new Worker(
      RADAR_QUEUE_NAME,
      async (job) => (job.name === 'digest' ? this.radar.dispatchDigest() : this.radar.runScan()),
      { connection: redisConnection() },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`radar job ${job?.id} (${job?.name}) failed: ${error.message}`),
    );
    await this.queue.upsertJobScheduler('radar-scan', { pattern: scanCron }, { name: 'scan' });
    await this.queue.upsertJobScheduler(
      'radar-digest',
      { pattern: digestCron },
      { name: 'digest' },
    );
    this.logger.log(`Radar planifié: scan ${scanCron}, brief ${digestCron}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
