import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { TenderModule } from '../tender/tender.module';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { VaultModule } from '../vault/vault.module';
import { computeReadiness } from '../vault/validity';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { buildDigest, renderDigestFr } from './digest.domain';
import {
  DrizzleOutboxRepository,
  InMemoryOutboxRepository,
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from './outbox.repository';
import {
  createTransportFromEnv,
  DELIVERY_TRANSPORT,
  type DeliveryTransport,
} from './transport';

@Controller('digest')
export class DigestController {
  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DELIVERY_TRANSPORT) private readonly transport: DeliveryTransport,
  ) {}

  /** The 07:30 brief — JSON + rendered French text (email/WhatsApp body). */
  @Roles('marches', 'direction', 'admin-si', 'finance')
  @Get()
  async today() {
    const digest = await this.buildToday();
    return { ...digest.data, texte: digest.texte };
  }

  /**
   * Dispatch the brief through the outbox: recorded first, then sent via
   * the configured transport (console until SMTP/WhatsApp creds exist).
   * DIGEST_RECIPIENTS env: comma-separated addresses; defaults to direction.
   */
  @Roles('direction', 'admin-si')
  @Post('dispatch')
  async dispatch() {
    const digest = await this.buildToday();
    const recipients = (process.env.DIGEST_RECIPIENTS ?? 'direction@agha-rm-infra.ma')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const results = [];
    for (const recipient of recipients) {
      const queued = await this.outbox.enqueue({
        channel: this.transport.channel,
        recipient,
        subject: `ATLAS — brief du ${new Date().toLocaleDateString('fr-MA')}`,
        body: digest.texte,
      });
      try {
        await this.transport.send({
          recipient,
          subject: queued.subject,
          body: queued.body,
        });
        results.push(await this.outbox.markSent(queued.id, new Date()));
      } catch (error) {
        new Logger('Digest').error(`delivery failed for ${recipient}`, error);
        results.push(
          await this.outbox.markFailed(
            queued.id,
            error instanceof Error ? error.message : 'unknown',
          ),
        );
      }
    }
    return { dispatched: results.length, results };
  }

  /** Delivery audit trail. */
  @Roles('direction', 'admin-si')
  @Get('outbox')
  async recent(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const capped =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    return this.outbox.listRecent(capped);
  }

  private async buildToday() {
    const now = new Date();
    const [tenders, documents] = await Promise.all([
      this.tenders.findAll(),
      this.vault.findAll(),
    ]);
    const data = buildDigest(tenders, computeReadiness(documents, now), now);
    return { data, texte: renderDigestFr(data) };
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

@Module({
  imports: [TenderModule, VaultModule],
  controllers: [DigestController],
  providers: [outboxRepositoryProvider, transportProvider],
})
export class DigestModule {}
