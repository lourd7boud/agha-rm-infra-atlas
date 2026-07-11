// RadarService — l'agent proactif: (1) scan horaire qui score les marchés en
// cours, (2) brief quotidien qui pousse le top des opportunités fraîches vers
// l'outbox (même canal que le digest). Toute étape est encapsulée: un échec
// journalise mais ne fait jamais échouer le job BullMQ (leçon Sentinel).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_REPOSITORY, type OutboxRepository } from '../digest/outbox.repository';
import { DELIVERY_TRANSPORT, type DeliveryTransport } from '../digest/transport';
import {
  RADAR_REPOSITORY,
  type RadarCandidateRecord,
  type RadarRepository,
  type RadarScanSummary,
} from './radar.repository';

const intEnv = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export interface RadarDigestSummary {
  envoyes: number;
  top: Array<{ score: number; objet: string; acheteur: string }>;
}

@Injectable()
export class RadarService {
  private readonly logger = new Logger('Radar');

  constructor(
    @Inject(RADAR_REPOSITORY) private readonly repo: RadarRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DELIVERY_TRANSPORT) private readonly transport: DeliveryTransport,
  ) {}

  /** Passe de scoring (horaire). Ne rejette jamais: tout échec est journalisé. */
  async runScan(): Promise<RadarScanSummary> {
    const limit = intEnv(process.env.RADAR_SCAN_LIMIT, 2000);
    try {
      const summary = await this.repo.scanCatalogue(new Date(), limit);
      this.logger.log(
        `Radar scan: ${summary.evalues} marchés évalués (+${summary.inseres} / ${summary.maj} maj), ` +
          `score max ${summary.scoreMax}, moyen ${summary.scoreMoyen}, ${summary.acheteursAvecIntel} acheteurs avec intel`,
      );
      return summary;
    } catch (error) {
      this.logger.error(`Radar scan échec: ${(error as Error).message}`);
      return { evalues: 0, inseres: 0, maj: 0, acheteursAvecIntel: 0, scoreMax: 0, scoreMoyen: 0 };
    }
  }

  /** Brief quotidien: top opportunités fraîches → outbox (audit + transport). */
  async dispatchDigest(): Promise<RadarDigestSummary> {
    const topN = intEnv(process.env.RADAR_TOP_N, 5);
    const minScore = intEnv(process.env.RADAR_MIN_SCORE, 60);
    const recipients = (process.env.RADAR_RECIPIENTS ?? process.env.DIGEST_RECIPIENTS ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    let top: RadarCandidateRecord[] = [];
    try {
      top = await this.repo.topForDigest(topN, minScore);
    } catch (error) {
      this.logger.error(`Radar digest (lecture) échec: ${(error as Error).message}`);
      return { envoyes: 0, top: [] };
    }
    if (top.length === 0) {
      this.logger.log('Radar digest: aucune opportunité au-dessus du seuil aujourd’hui');
      return { envoyes: 0, top: [] };
    }

    const subject = `🎯 Radar ATLAS — ${top.length} opportunité(s) à traiter`;
    const body = renderRadarBrief(top);

    let envoyes = 0;
    for (const recipient of recipients.length ? recipients : ['console']) {
      let recordId: string | null = null;
      try {
        const record = await this.outbox.enqueue({
          channel: this.transport.channel,
          recipient,
          subject,
          body,
        });
        recordId = record.id;
        await this.transport.send({ recipient, subject, body });
        await this.outbox.markSent(record.id, new Date());
        envoyes += 1;
      } catch (error) {
        if (recordId) {
          await this.outbox.markFailed(recordId, (error as Error).message).catch(() => undefined);
        }
        this.logger.error(`Radar digest → ${recipient} échec: ${(error as Error).message}`);
      }
    }
    this.logger.log(`Radar digest: ${envoyes} envoi(s), top score ${top[0]?.score}`);
    return {
      envoyes,
      top: top.map((t) => ({ score: t.score, objet: t.objet, acheteur: t.buyerName })),
    };
  }
}

function joursRestants(deadline: Date): number {
  return Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
}

/** Corps texte du brief (FR) — devient outbox.body. */
export function renderRadarBrief(top: RadarCandidateRecord[]): string {
  const lines: string[] = [];
  lines.push('Radar ATLAS — opportunités prioritaires du jour');
  lines.push('');
  top.forEach((c, i) => {
    const lieu = c.ville || c.region || c.location || 'Lieu non précisé';
    const jr = joursRestants(c.deadlineAt);
    lines.push(`${i + 1}. [${c.score}/100] ${c.objet.slice(0, 120)}`);
    lines.push(`   Acheteur: ${c.buyerName}`);
    lines.push(`   Lieu: ${lieu} · Catégorie: ${c.category ?? '—'} · Échéance: J-${jr}`);
    if (c.reasons.length) lines.push(`   ${c.reasons.slice(0, 4).join('  ')}`);
    if (c.sourceUrl) lines.push(`   ${c.sourceUrl}`);
    lines.push('');
  });
  lines.push('— Ouvrez le Radar dans ATLAS pour poursuivre ou écarter chaque opportunité.');
  return lines.join('\n');
}
