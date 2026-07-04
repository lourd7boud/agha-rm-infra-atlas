import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CAUTION_REPOSITORY,
  type CautionRepository,
} from '../finance/caution.repository';
import { summarizeCautions } from '../finance/finance.domain';
import {
  FIELD_REPOSITORY,
  type FieldRepository,
} from '../field/field.repository';
import { summarizeLogs } from '../field/field.domain';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
  type SituationWithProject,
} from '../project/project.repository';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { computeReadiness } from '../vault/validity';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { buildDigest, renderDigestFr } from './digest.domain';
import {
  OUTBOX_REPOSITORY,
  type OutboxRecord,
  type OutboxRepository,
} from './outbox.repository';
import { DELIVERY_TRANSPORT, type DeliveryTransport } from './transport';

export interface DigestText {
  data: ReturnType<typeof buildDigest>;
  texte: string;
}

/**
 * Composes the unified morning brief across divisions and dispatches it
 * through the outbox. Shared by the controller (manual) and the module's
 * scheduler (autonomous, DIGEST_CRON).
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger('Digest');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DELIVERY_TRANSPORT) private readonly transport: DeliveryTransport,
    @Inject(CAUTION_REPOSITORY) private readonly cautions: CautionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(FIELD_REPOSITORY) private readonly field: FieldRepository,
  ) {}

  /** v2: tender brief + treasury + chantiers in one unified text. */
  async buildToday(): Promise<DigestText> {
    const now = new Date();
    const [tenders, documents, allCautions, allProjects, allSituations] =
      await Promise.all([
        // Projected read: buildDigest only reads reference/buyerName/deadlineAt/
        // pipelineState — never `raw` — so the slim knowledge projection avoids
        // shipping the whole catalogue's raw jsonb on every dashboard + cron run.
        this.tenders.findAllForKnowledge(),
        this.vault.findAll(),
        this.cautions.findAll(),
        this.projects.findAll(),
        this.projects.listAllSituations(),
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
      // Situations for every project came back in one query above; index them
      // here so the per-chantier loop is a map lookup, not an N+1.
      const lastSituationByProject = indexLastSituationByProject(allSituations);
      lines.push('', '— CHANTIERS —');
      for (const project of enCours) {
        // Field logs stay per-project: no batch read exists on FieldRepository
        // and adding one is out of scope here (see assessment in PR notes).
        const logs = await this.field.listLogs(project.id);
        const last = lastSituationByProject.get(project.id);
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

  /** Render → outbox → transport, per recipient. */
  async dispatch(): Promise<{ dispatched: number; results: (OutboxRecord | null)[] }> {
    const digest = await this.buildToday();
    const recipients = (process.env.DIGEST_RECIPIENTS ?? 'direction@agha-rm-infra.ma')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const results: (OutboxRecord | null)[] = [];
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
        this.logger.error(`delivery failed for ${recipient}`, error);
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

  recent(limit: number): Promise<OutboxRecord[]> {
    return this.outbox.listRecent(limit);
  }
}

/**
 * Index situations by project, keeping the latest one (highest numero) per
 * project — the décompte that drives the chantier's avancement. Picking the max
 * numero (rather than the array's last element) keeps the result independent of
 * the order listAllSituations() returns rows in.
 */
function indexLastSituationByProject(
  situations: readonly SituationWithProject[],
): Map<string, SituationWithProject> {
  const byProject = new Map<string, SituationWithProject>();
  for (const situation of situations) {
    const current = byProject.get(situation.projectId);
    if (!current || situation.numero > current.numero) {
      byProject.set(situation.projectId, situation);
    }
  }
  return byProject;
}
