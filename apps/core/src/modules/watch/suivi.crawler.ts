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
import { isBlockStatus, PortalBlockedError } from './portal-fetch';

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
  /**
   * True when the batch halted early on a run of consecutive fetch failures —
   * the portal is likely blocking/down. The caller MUST back off (not launch
   * the next batch): firing the rest of an ~80 k-target backlog into a live ban
   * is exactly how a soft-ban becomes a hard one.
   */
  stoppedEarly?: boolean;
}

export interface SuiviCrawlOptions {
  maxSuivi?: number;
  delayMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG for delay jitter (default Math.random). */
  random?: () => number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 30_000;
/**
 * Consecutive fetch failures that mean the portal is blocking/down. At that
 * point the batch stops rather than firing every remaining target into the
 * block — the circuit breaker that makes a mass drain safe to run unattended.
 */
const BLOCK_THRESHOLD = 5;
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Randomize a base delay ±40% so ~80 k sequential GETs don't share one cadence. */
function jitter(baseMs: number, random: () => number): number {
  return Math.round(baseMs * (0.6 + random() * 0.8));
}

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
    const doFetch = opts.fetchImpl ?? fetch;
    const sleep = opts.sleep ?? defaultSleep;
    const random = opts.random ?? Math.random;
    const targets = await this.tenders.findSuiviBacklogTargets(maxSuivi);

    let fetched = 0;
    let withBidders = 0;
    let bidsStored = 0;
    let errors = 0;
    // Circuit breaker: consecutive fetch failures ⇒ the portal is blocking.
    let consecutiveFailures = 0;
    let stoppedEarly = false;

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i]!;
      const refOrg = refOrgFromUrl(t.sourceUrl);
      if (!refOrg) {
        // Not a portal failure — a malformed stored URL. Stamp it out of the
        // backlog and move on WITHOUT touching the breaker counter.
        await this.stamp(t.id, 0);
        if (delayMs > 0 && i < targets.length - 1) await sleep(jitter(delayMs, random));
        continue;
      }
      const url = buildSuiviUrl(
        refOrg.refConsultation,
        refOrg.orgAcronyme,
        t.sourceUrl,
      );

      let html: string;
      try {
        html = await this.fetchText(doFetch, url);
        // The portal responded → it is not blocking us. Reset the breaker.
        consecutiveFailures = 0;
        fetched += 1;
      } catch (err) {
        errors += 1;
        // A 429/403 is a hard block — halt on the FIRST one (parity with the
        // detail/result/pv crawlers), not after 5 wasted requests.
        if (err instanceof PortalBlockedError) {
          stoppedEarly = true;
          this.logger.warn(
            'suivi batch halted on a portal block (429/403) — backing off ' +
              '(targets left un-stamped, a later run resumes them).',
          );
          break;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= BLOCK_THRESHOLD) {
          stoppedEarly = true;
          this.logger.warn(
            `suivi batch halted after ${BLOCK_THRESHOLD} consecutive fetch ` +
              `failures — portal likely blocking; backing off (targets left ` +
              `un-stamped, a later run resumes them).`,
          );
          break;
        }
        if (delayMs > 0 && i < targets.length - 1) await sleep(jitter(delayMs, random));
        continue;
      }

      // Parse + persist. A failure here is a data/DB problem, NOT a portal
      // block, so it must not trip the breaker — leave consecutiveFailures at 0.
      try {
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
      if (delayMs > 0 && i < targets.length - 1) await sleep(jitter(delayMs, random));
    }

    const summary: SuiviCrawlSummary = {
      targets: targets.length,
      fetched,
      withBidders,
      bidsStored,
      errors,
      ...(stoppedEarly ? { stoppedEarly: true } : {}),
    };
    this.logger.log(`suivi crawl complete ${JSON.stringify(summary)}`);
    return summary;
  }

  /** Stamp raw.suivi so the row leaves the backlog (harvested exactly once). */
  private async stamp(id: string, bidderCount: number): Promise<void> {
    await this.tenders.updateEnrichment(id, {}, {
      suivi: { v: SUIVI_VERSION, fetchedAt: new Date().toISOString(), bidderCount },
    });
  }

  private async fetchText(doFetch: typeof fetch, url: string): Promise<string> {
    const res = await doFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}
