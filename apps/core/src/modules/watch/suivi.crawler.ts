import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { parseSuiviCommission, refOrgFromUrl, buildSuiviUrl } from './suivi.parser';

/**
 * Stage-3b crawl — harvest the FULL competitor field from "Suivre la commission"
 * (SuiviConsultation) for every past-deadline consultation we hold. Unlike the
 * scanned résultat/PV notices (OCR + vision LLM), the commission table is
 * structured HTML, so this is cheap and complete: one polite GET → parse → store
 * every soumissionnaire + amount as a competitor_bid, scoped to the tender's own
 * reference + buyer. Stamps raw.suivi so a row is harvested once (idempotent).
 */

export const SUIVI_VERSION = 1;

export interface SuiviCrawlSummary {
  targets: number;
  fetched: number;
  withBidders: number;
  bidsStored: number;
  errors: number;
}

export interface SuiviCrawlOptions {
  maxSuivi?: number;
  delayMs?: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 30_000;
const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SuiviCrawlerService {
  private readonly logger = new Logger('SuiviCrawler');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
  ) {}

  /**
   * DB-driven backlog harvest: past-deadline tenders whose commission we have
   * not read yet (no raw.suivi.v marker), newest-first. One GET per tender.
   */
  async crawlBacklog(opts: SuiviCrawlOptions = {}): Promise<SuiviCrawlSummary> {
    const maxSuivi = Math.max(0, Math.floor(opts.maxSuivi ?? 40));
    const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 800));
    const targets = await this.tenders.findSuiviBacklogTargets(maxSuivi);

    let fetched = 0;
    let withBidders = 0;
    let bidsStored = 0;
    let errors = 0;

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i]!;
      try {
        const refOrg = refOrgFromUrl(t.sourceUrl);
        if (!refOrg) {
          await this.stamp(t.id, 0);
          continue;
        }
        const url = buildSuiviUrl(
          refOrg.refConsultation,
          refOrg.orgAcronyme,
          t.sourceUrl,
        );
        const html = await this.fetchText(url);
        fetched += 1;
        const { bidders, winner } = parseSuiviCommission(html);

        for (const b of bidders) {
          if (!b.entreprise) continue;
          const competitor = await this.intel.upsertCompetitor(b.entreprise);
          const ok = await this.intel.insertResult(
            {
              reference: t.reference,
              buyerName: t.buyerName,
              bidderName: b.entreprise,
              ...(b.amountMad != null ? { amountMad: b.amountMad } : {}),
              isWinner: winner ? b.entreprise === winner.entreprise : false,
              resultDate: t.deadlineAt,
              sourceUrl: url,
            },
            competitor.id,
          );
          if (ok) bidsStored += 1;
        }
        if (bidders.length > 0) withBidders += 1;
        await this.stamp(t.id, bidders.length);
      } catch {
        errors += 1;
      }
      if (delayMs > 0 && i < targets.length - 1) await sleepMs(delayMs);
    }

    const summary = { targets: targets.length, fetched, withBidders, bidsStored, errors };
    this.logger.log(`suivi crawl complete ${JSON.stringify(summary)}`);
    return summary;
  }

  /** Stamp raw.suivi so the row leaves the backlog (harvested exactly once). */
  private async stamp(id: string, bidderCount: number): Promise<void> {
    await this.tenders.updateEnrichment(id, {}, {
      suivi: { v: SUIVI_VERSION, fetchedAt: new Date().toISOString(), bidderCount },
    });
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}
