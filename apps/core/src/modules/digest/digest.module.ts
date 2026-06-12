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
import {
  CAUTION_REPOSITORY,
  type CautionRepository,
} from '../finance/caution.repository';
import { FinanceModule } from '../finance/finance.module';
import { summarizeCautions } from '../finance/finance.domain';
import {
  FIELD_REPOSITORY,
  type FieldRepository,
} from '../field/field.repository';
import { FieldModule } from '../field/field.module';
import { summarizeLogs } from '../field/field.domain';
import { ProjectModule } from '../project/project.module';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../project/project.repository';
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
    @Inject(CAUTION_REPOSITORY) private readonly cautions: CautionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(FIELD_REPOSITORY) private readonly field: FieldRepository,
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

  /** v2: the tender brief + treasury + chantiers in one unified text. */
  private async buildToday() {
    const now = new Date();
    const [tenders, documents, allCautions, allProjects] = await Promise.all([
      this.tenders.findAll(),
      this.vault.findAll(),
      this.cautions.findAll(),
      this.projects.findAll(),
    ]);
    const data = buildDigest(tenders, computeReadiness(documents, now), now);

    const lines: string[] = [renderDigestFr(data)];

    const tresorerie = summarizeCautions(allCautions, now);
    lines.push(
      '',
      '— TRÉSORERIE —',
      `Cautions actives: ${tresorerie.activeCount} (${Math.round(tresorerie.activeTotalMad).toLocaleString('fr-MA')} MAD bloqués)`,
    );

    const enCours = allProjects.filter((p) => p.status === 'en_cours');
    if (enCours.length > 0) {
      lines.push('', '— CHANTIERS —');
      for (const project of enCours) {
        const [situations, logs] = await Promise.all([
          this.projects.listSituations(project.id),
          this.field.listLogs(project.id),
        ]);
        const last = situations[situations.length - 1];
        const journal = summarizeLogs(logs);
        const alerte =
          journal.blocagesOuverts > 0
            ? ` ⚠ ${journal.blocagesOuverts} blocage(s)`
            : '';
        lines.push(
          `${project.reference}: ${last?.avancementPct ?? 0}% — effectif moyen ${journal.effectifMoyen}${alerte}`,
        );
      }
    }

    return { data, texte: lines.join('\n') };
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
  imports: [TenderModule, VaultModule, FinanceModule, FieldModule, ProjectModule],
  controllers: [DigestController],
  providers: [outboxRepositoryProvider, transportProvider],
})
export class DigestModule {}
