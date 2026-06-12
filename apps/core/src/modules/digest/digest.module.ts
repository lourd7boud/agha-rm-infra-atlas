import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Post,
  Query,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { FieldModule } from '../field/field.module';
import { ProjectModule } from '../project/project.module';
import { TenderModule } from '../tender/tender.module';
import { VaultModule } from '../vault/vault.module';
import { DigestService } from './digest.service';
import {
  DrizzleOutboxRepository,
  InMemoryOutboxRepository,
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from './outbox.repository';
import {
  createTransportFromEnv,
  DELIVERY_TRANSPORT,
} from './transport';

const DIGEST_QUEUE_NAME = 'digest';
const DIGEST_QUEUE = Symbol('DIGEST_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

@Controller('digest')
export class DigestController {
  constructor(@Inject(DigestService) private readonly digest: DigestService) {}

  /** The 07:30 brief — JSON + rendered French text (email/WhatsApp body). */
  @Roles('marches', 'direction', 'admin-si', 'finance')
  @Get()
  async today() {
    const built = await this.digest.buildToday();
    return { ...built.data, texte: built.texte };
  }

  /**
   * Dispatch the brief through the outbox (manual trigger; DIGEST_CRON
   * covers the autonomous schedule). DIGEST_RECIPIENTS env, comma-separated.
   */
  @Roles('direction', 'admin-si')
  @Post('dispatch')
  async dispatch() {
    return this.digest.dispatch();
  }

  /** Delivery audit trail. */
  @Roles('direction', 'admin-si')
  @Get('outbox')
  async recent(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const capped =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    return this.digest.recent(capped);
  }
}

const outboxRepositoryProvider = {
  provide: OUTBOX_REPOSITORY,
  useFactory: (): OutboxRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleOutboxRepository(getDb(url));
    new Logger('DigestModule').warn(
      'DATABASE_URL not set — outbox uses a non-persistent in-memory repository',
    );
    return new InMemoryOutboxRepository();
  },
};

const transportProvider = {
  provide: DELIVERY_TRANSPORT,
  useFactory: createTransportFromEnv,
};

const digestQueueProvider = {
  provide: DIGEST_QUEUE,
  useFactory: () =>
    new Queue(DIGEST_QUEUE_NAME, { connection: redisConnection() }),
};

@Module({
  imports: [TenderModule, VaultModule, FinanceModule, FieldModule, ProjectModule],
  controllers: [DigestController],
  providers: [
    DigestService,
    outboxRepositoryProvider,
    transportProvider,
    digestQueueProvider,
  ],
})
export class DigestModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DigestModule');
  private worker: Worker | null = null;

  constructor(
    @Inject(DigestService) private readonly digest: DigestService,
    @Inject(DIGEST_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // The morning brief is an autonomous agent: it fires on DIGEST_CRON
    // with no human trigger, exactly like the Sentinel.
    const cron = process.env.DIGEST_CRON;
    if (!cron) return;

    this.worker = new Worker(
      DIGEST_QUEUE_NAME,
      async () => this.digest.dispatch(),
      { connection: redisConnection() },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`digest job ${job?.id} failed: ${error.message}`),
    );
    await this.queue.upsertJobScheduler('digest-schedule', { pattern: cron });
    this.logger.log(`Morning brief scheduled: ${cron}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
