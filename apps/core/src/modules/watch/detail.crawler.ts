import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import {
  DETAIL_VERSION,
  extractDetailLinks,
  parseDetailPage,
  type DetailFields,
} from './detail.parser';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';
import {
  PortalBlockedError,
  PORTAL_BLOCK_THRESHOLD,
  isBlockStatus,
  jitter,
} from './portal-fetch';

/**
 * The full published-metadata block we persist under raw.detail. Everything the
 * detail page publishes EXCEPT reference/objet (those are the join key / already
 * a column). Stamped with the parser version + provenance so the backfill knows
 * whether a row was harvested by the current parser. This is the portal-first
 * source of truth the UI reads and the LLM defers to.
 */
export function buildDetailMeta(
  fields: DetailFields,
  url: string,
  fetchedAt: string,
): Record<string, unknown> {
  const { reference: _reference, objet: _objet, ...portal } = fields;
  return { url, fetchedAt, v: DETAIL_VERSION, ...portal };
}

/**
 * Canonical join key between a listing stub and its detail page. The live Atexo
 * listing stores the reference WITH the objet glued on ("19/2026/C.TT - ..." /
 * "…objet: …"); the detail page carries the clean référence. Cut at the " - " /
 * "objet:" separator so both sides collapse to the same key.
 */
export function normalizeReference(reference: string): string {
  const head = reference.split(/\s+-\s+|objet\s*:/i)[0] ?? reference;
  return head.replace(/\s+/g, ' ').trim().toUpperCase();
}

export interface CrawlSummary {
  linksFound: number;
  fetched: number;
  matched: number;
  enriched: number;
  errors: number;
  /**
   * True when the run halted early on a portal block (429/403) or a run of
   * consecutive fetch failures — the caller (WatchService) should back off, not
   * launch the next portal stage into the same block.
   */
  stoppedEarly?: boolean;
}

export interface CrawlOptions {
  /** Hard cap on detail pages fetched per run (politeness + runaway guard). */
  maxDetails?: number;
  /** Polite delay between detail fetches (ms). */
  delayMs?: number;
  /** Injectable RNG for delay jitter (default Math.random). */
  random?: () => number;
}

interface TenderLite {
  id: string;
  reference: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
}

export interface CrawlDeps {
  fetchDetail: (url: string) => Promise<string>;
  tenders: readonly TenderLite[];
  applyEnrichment: (
    id: string,
    amounts: { estimationMad?: number; cautionProvisoireMad?: number },
    detailMeta: Record<string, unknown>,
  ) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  /** Injectable RNG for delay jitter (default Math.random). */
  random?: () => number;
}

/**
 * Stage-2 detail crawl (pure orchestrator). From a listing page: extract the
 * distinct consultation detail URLs, fetch each (politely, bounded), parse it,
 * match back to a stored tender by normalized reference, and fill the missing
 * caution/estimation. Only fills empty fields — published portal data wins, we
 * never overwrite a known value. Deps are injected so this is unit-testable
 * without HTTP or a database.
 */
export async function crawlDetails(
  listingHtml: string,
  baseUrl: string,
  deps: CrawlDeps,
  opts: CrawlOptions = {},
): Promise<CrawlSummary> {
  const maxDetails = Math.max(0, Math.floor(opts.maxDetails ?? 40));
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 800));
  const random = deps.random ?? opts.random ?? Math.random;

  const byRef = new Map<string, TenderLite>();
  for (const tender of deps.tenders) {
    byRef.set(normalizeReference(tender.reference), tender);
  }

  const links = extractDetailLinks(listingHtml, baseUrl).slice(0, maxDetails);
  let fetched = 0;
  let matched = 0;
  let enriched = 0;
  let errors = 0;
  // Circuit breaker: a portal block (or a run of consecutive fetch failures)
  // halts the batch instead of firing the rest of the backlog into the ban.
  let consecutiveFailures = 0;
  let stoppedEarly = false;

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]!;
    let html: string;
    try {
      html = await deps.fetchDetail(link.detailUrl);
      consecutiveFailures = 0;
      fetched += 1;
    } catch (err) {
      errors += 1;
      if (err instanceof PortalBlockedError) {
        stoppedEarly = true;
        break;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= PORTAL_BLOCK_THRESHOLD) {
        stoppedEarly = true;
        break;
      }
      if (delayMs > 0 && i < links.length - 1) await deps.sleep(jitter(delayMs, random));
      continue;
    }

    // Parse + persist. A failure here is a data/DB problem, not a portal block,
    // so it must not trip the breaker.
    try {
      const fields = parseDetailPage(html);
      const tender = fields.reference
        ? byRef.get(normalizeReference(fields.reference))
        : undefined;
      if (tender) {
        matched += 1;
        const amounts: { estimationMad?: number; cautionProvisoireMad?: number } = {};
        if (tender.estimationMad === undefined && fields.estimationMad != null) {
          amounts.estimationMad = fields.estimationMad;
        }
        if (
          tender.cautionProvisoireMad === undefined &&
          fields.cautionProvisoireMad != null
        ) {
          amounts.cautionProvisoireMad = fields.cautionProvisoireMad;
        }
        await deps.applyEnrichment(
          tender.id,
          amounts,
          buildDetailMeta(fields, link.detailUrl, deps.now()),
        );
        if (Object.keys(amounts).length > 0) enriched += 1;
      }
    } catch {
      errors += 1;
    }
    if (delayMs > 0 && i < links.length - 1) await deps.sleep(jitter(delayMs, random));
  }

  return {
    linksFound: links.length,
    fetched,
    matched,
    enriched,
    errors,
    ...(stoppedEarly ? { stoppedEarly: true } : {}),
  };
}

const USER_AGENT = 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)';
const DETAIL_TIMEOUT_MS = 30_000;
const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wires the pure crawler to the live portal (listing via PORTAL_SOURCE, each
 * detail via a polite GET) and the tender repository. Trigger via the endpoint;
 * estimation stays confidential on open tenders so most runs fill the caution +
 * record the detail URL, and back-fill the estimation when a tender publishes it.
 */
@Injectable()
export class DetailCrawlerService {
  private readonly logger = new Logger('DetailCrawler');

  constructor(
    @Inject(PORTAL_SOURCE) private readonly source: PortalSource,
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
  ) {}

  async crawlOnce(opts: CrawlOptions = {}): Promise<CrawlSummary> {
    const listing = await this.source.fetch(1);
    const tenders = await this.tenders.findAll();
    const summary = await crawlDetails(
      listing.html,
      listing.sourceUrl,
      {
        fetchDetail: (url) => this.fetchDetail(url),
        tenders,
        applyEnrichment: async (id, amounts, detailMeta) => {
          await this.tenders.updateEnrichment(id, amounts, { detail: detailMeta });
        },
        sleep: sleepMs,
        now: () => new Date().toISOString(),
      },
      opts,
    );
    this.logger.log(`detail crawl complete ${JSON.stringify(summary)}`);
    return summary;
  }

  /**
   * DB-driven backfill — the fix for the "page-1 blindness" that left fresh
   * tenders without their caution. Instead of walking the portal listing, it
   * targets OUR rows that still miss the caution (newest first) through their
   * stored canonical detail URL. Zero LLM. Every visited row gets the
   * raw.detail stamp — even when the page prints no caution — so a row is
   * attempted exactly once and the work list always shrinks.
   */
  async backfillMissing(opts: CrawlOptions = {}): Promise<CrawlSummary> {
    const maxDetails = Math.max(0, Math.floor(opts.maxDetails ?? 40));
    const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 800));
    const random = opts.random ?? Math.random;
    const targets = await this.tenders.findDetailBackfillTargets(maxDetails);

    let fetched = 0;
    let matched = 0;
    let enriched = 0;
    let errors = 0;
    // Circuit breaker: with an ~85k-row backlog drained 300/sweep, a WAF block
    // mid-sweep must halt the batch, not fire the remaining ~250 GETs into it.
    let consecutiveFailures = 0;
    let stoppedEarly = false;

    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]!;
      let html: string;
      try {
        html = await this.fetchDetail(target.sourceUrl);
        consecutiveFailures = 0;
        fetched += 1;
      } catch (err) {
        errors += 1;
        if (err instanceof PortalBlockedError) {
          stoppedEarly = true;
          break;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= PORTAL_BLOCK_THRESHOLD) {
          stoppedEarly = true;
          break;
        }
        if (delayMs > 0 && i < targets.length - 1) await sleepMs(jitter(delayMs, random));
        continue;
      }

      try {
        const fields = parseDetailPage(html);
        matched += 1;
        const amounts: { estimationMad?: number; cautionProvisoireMad?: number } = {};
        if (target.estimationMad === undefined && fields.estimationMad != null) {
          amounts.estimationMad = fields.estimationMad;
        }
        if (
          target.cautionProvisoireMad === undefined &&
          fields.cautionProvisoireMad != null
        ) {
          amounts.cautionProvisoireMad = fields.cautionProvisoireMad;
        }
        await this.tenders.updateEnrichment(target.id, amounts, {
          detail: buildDetailMeta(fields, target.sourceUrl, new Date().toISOString()),
        });
        if (Object.keys(amounts).length > 0) enriched += 1;
      } catch {
        errors += 1;
      }
      if (delayMs > 0 && i < targets.length - 1) await sleepMs(jitter(delayMs, random));
    }

    const summary = {
      linksFound: targets.length,
      fetched,
      matched,
      enriched,
      errors,
      ...(stoppedEarly ? { stoppedEarly: true } : {}),
    };
    this.logger.log(`detail backfill complete ${JSON.stringify(summary)}`);
    return summary;
  }

  private async fetchDetail(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });
    if (isBlockStatus(response.status)) {
      throw new PortalBlockedError(response.status);
    }
    if (!response.ok) {
      throw new Error(`Detail fetch failed: HTTP ${response.status}`);
    }
    return response.text();
  }
}
