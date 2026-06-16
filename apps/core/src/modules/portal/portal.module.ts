import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { IntelModule } from '../intel/intel.module';
import { PortalAuthSession, portalAuthConfigFromEnv } from './portal-auth';
import {
  DrizzlePortalRepository,
  InMemoryPortalRepository,
  PORTAL_REPOSITORY,
  type PortalRepository,
} from './portal.repository';
import { MesReponsesCrawlerService } from './mes-reponses.crawler';
import { MesCautionsCrawlerService } from './mes-cautions.crawler';
import { PortalOutcomeService } from './portal-outcome.service';

/**
 * Portal connector module — wires the authenticated marchespublics.gov.ma
 * account surfaces: the two READ-ONLY harvests ("Mes réponses", "Mes cautions")
 * and the outcome reconciliation service. Mirrors watch.module.ts: a Drizzle
 * repository when DATABASE_URL is set (in-memory otherwise), a BullMQ worker, and
 * a low-frequency scheduled job. The harvests login once then issue polite
 * read-only GETs; when portal credentials are absent the job skips cleanly
 * instead of crashing the boot.
 */

const QUEUE_NAME = 'portal';
const PORTAL_QUEUE = Symbol('PORTAL_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

/** True when both portal credentials are present (the harvests can run). */
function hasPortalCredentials(): boolean {
  try {
    portalAuthConfigFromEnv();
    return true;
  } catch {
    return false;
  }
}

@Controller('portal')
export class PortalController {
  constructor(
    @Inject(PortalOutcomeService)
    private readonly outcomes: PortalOutcomeService,
  ) {}

  /**
   * READ-ONLY reconciliation: our soumissions joined with the public results —
   * gagné / perdu / en attente / retiré, with the winner name + montant when an
   * attribution is published. Never writes (no submission_outcome derivation).
   */
  @Roles('marches', 'direction', 'admin-si')
  @Get('outcomes')
  async outcomesReport() {
    return this.outcomes.ourSubmissionsWithOutcome();
  }
}

const portalRepositoryProvider = {
  provide: PORTAL_REPOSITORY,
  useFactory: (): PortalRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzlePortalRepository(getDb(url));
    new Logger('PortalModule').warn(
      'DATABASE_URL not set — portal uses a non-persistent in-memory repository',
    );
    return new InMemoryPortalRepository();
  },
};

const portalSessionProvider = {
  provide: PortalAuthSession,
  useFactory: (): PortalAuthSession | null => {
    const logger = new Logger('PortalModule');
    if (!hasPortalCredentials()) {
      logger.warn(
        'PORTAL_AUTH_LOGIN/PORTAL_AUTH_PASSWORD not set — portal harvests disabled (read-only outcomes still served from stored data)',
      );
      return null;
    }
    // NEVER pass baseUrl in production wiring (defaults to the official host).
    return new PortalAuthSession(portalAuthConfigFromEnv());
  },
};

const portalQueueProvider = {
  provide: PORTAL_QUEUE,
  useFactory: (): Queue =>
    new Queue(QUEUE_NAME, { connection: redisConnection() }),
};

@Module({
  imports: [IntelModule],
  controllers: [PortalController],
  providers: [
    portalRepositoryProvider,
    portalSessionProvider,
    portalQueueProvider,
    MesReponsesCrawlerService,
    MesCautionsCrawlerService,
    PortalOutcomeService,
  ],
  exports: [portalRepositoryProvider, PortalOutcomeService],
})
export class PortalModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PortalModule');
  private worker: Worker | null = null;

  constructor(
    @Inject(MesReponsesCrawlerService)
    private readonly reponses: MesReponsesCrawlerService,
    @Inject(MesCautionsCrawlerService)
    private readonly cautions: MesCautionsCrawlerService,
    @Inject(PORTAL_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(QUEUE_NAME, async () => this.harvestBoth(), {
      connection: redisConnection(),
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`portal job ${job?.id} failed: ${error.message}`),
    );

    // Low-frequency by default (the account surfaces change slowly); override
    // with PORTAL_CRON. Skip scheduling entirely when creds are absent so we
    // never spin a job that can only fail to authenticate.
    const cron = process.env.PORTAL_CRON ?? '0 7 * * *';
    if (hasPortalCredentials()) {
      await this.queue.upsertJobScheduler('portal-schedule', { pattern: cron });
      this.logger.log(`Portal harvest scheduled: ${cron}`);
    } else {
      this.logger.warn('Portal harvest not scheduled (credentials absent)');
    }
  }

  /** Runs both READ-ONLY harvests; a no-op when credentials are absent. */
  private async harvestBoth(): Promise<void> {
    if (!hasPortalCredentials()) {
      this.logger.warn('Portal harvest skipped (credentials absent)');
      return;
    }
    await this.reponses.harvest();
    await this.cautions.harvest();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
