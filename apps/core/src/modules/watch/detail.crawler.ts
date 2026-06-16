import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { extractDetailLinks, parseDetailPage } from './detail.parser';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';

/** Canonical join key between a listing stub and its detail page. */
export function normalizeReference(reference: string): string {
  return reference.replace(/\s+/g, ' ').trim().toUpperCase();
}

export interface CrawlSummary {
  linksFound: number;
  fetched: number;
  matched: number;
  enriched: number;
  errors: number;
}

export interface CrawlOptions {
  /** Hard cap on detail pages fetched per run (politeness + runaway guard). */
  maxDetails?: number;
  /** Polite delay between detail fetches (ms). */
  delayMs?: number;
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

  const byRef = new Map<string, TenderLite>();
  for (const tender of deps.tenders) {
    byRef.set(normalizeReference(tender.reference), tender);
  }

  const links = extractDetailLinks(listingHtml, baseUrl).slice(0, maxDetails);
  let fetched = 0;
  let matched = 0;
  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]!;
    try {
      const html = await deps.fetchDetail(link.detailUrl);
      fetched += 1;
      const fields = parseDetailPage(html);
      if (!fields.reference) continue;
      const tender = byRef.get(normalizeReference(fields.reference));
      if (!tender) continue;
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

      await deps.applyEnrichment(tender.id, amounts, {
        url: link.detailUrl,
        categorie: fields.categorie,
        fetchedAt: deps.now(),
      });
      if (Object.keys(amounts).length > 0) enriched += 1;
    } catch {
      errors += 1;
    }
    if (delayMs > 0 && i < links.length - 1) await deps.sleep(delayMs);
  }

  return { linksFound: links.length, fetched, matched, enriched, errors };
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

  private async fetchDetail(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Detail fetch failed: HTTP ${response.status}`);
    }
    return response.text();
  }
}
