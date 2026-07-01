import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import { UNKNOWN_BUYER_LABEL } from '../intel/rebate.domain';
import { ocrBytesToText } from '../tender/pdf-ocr';
import { extractDetailLinks, parseDetailPage } from './detail.parser';
import {
  ANNONCE_TYPE_EXTRAIT_PV,
  buildResultSearchBody,
  extractAvisDownloadUrl,
} from './result.parser';
import { EXTRAIT_PV_VISION_PROMPT, parseExtraitPvJson } from './pv.parser';
import { parseFormInputs } from './prado';
import {
  cookieHeader,
  DEFAULT_SEARCH_URL,
  fetchAvisBytes,
  fetchText,
  PORTAL_TIMEOUT,
  PORTAL_UA,
  sleepMs,
} from './portal-fetch';

export interface PvCrawlSummary {
  /** Candidate consultations walked (post-maxPv slice), not PVs actually read. */
  pvFound: number;
  notices: number;
  /** PV extracts successfully read (lisible + at least one bidder). */
  pvRead: number;
  /** Total bidder rows inserted or enriched (all soumissionnaires, not just winners). */
  bidsStored: number;
  errors: number;
}

export interface PvCrawlOptions {
  maxPv?: number;
  delayMs?: number;
  /**
   * Number of Extrait-de-PV listing pages to walk (PRADO postback "next").
   * 1 = the historical first-page-only behaviour that starved intel to 56
   * bids. The portal has 9,370 PV pages (~93,698 notices), so raising this
   * is how the competitor DB reaches datao scale. Default 1 keeps callers
   * that omit it (and the unit tests) on the old single-page path.
   */
  maxPages?: number;
}

export interface StoredPvBid {
  reference: string;
  buyerName: string;
  bidderName: string;
  amountMad: number | null;
  estimationMad: number | null;
  objet: string | null;
  isWinner: boolean;
  resultDate: Date;
  sourceUrl: string;
}

export interface PvCrawlDeps {
  /** GET the search form + POST with annonceType=5 → the PV-extract listing. */
  search: () => Promise<{ listingHtml: string; baseUrl: string }>;
  /**
   * Optional: PRADO postback to advance to the next page of the Extrait-PV
   * listing (uses the cookie + PRADO_PAGESTATE captured by search). Returns the
   * next page's HTML, or null when there are no more pages. Mirrors the result
   * crawler's pager — the fix that lets the PV harvest exceed page 1.
   */
  nextPage?: () => Promise<{ listingHtml: string; baseUrl: string } | null>;
  fetchDetail: (url: string) => Promise<string>;
  /** Download the PV bytes (PDF or scanned image) from the portal. */
  fetchAvisBytes: (url: string) => Promise<Uint8Array>;
  /** Turn those bytes into the JSON string for parseExtraitPvJson. */
  extractAvisText: (bytes: Uint8Array) => Promise<string>;
  storeBid: (b: StoredPvBid) => Promise<'inserted' | 'updated'>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

/**
 * Stage-3b PV crawl (pure orchestrator). Submit the extrait-de-PV search, walk
 * the consultations, vision-read each scanned PV, and store EVERY soumissionnaire
 * (winner + écartés) with the administrative estimation — feeding the rebate
 * calibration and the competitor database. Deps are injected for unit testing.
 */
export async function crawlExtraitsPv(
  deps: PvCrawlDeps,
  opts: PvCrawlOptions = {},
): Promise<PvCrawlSummary> {
  const maxPv = Math.max(0, Math.floor(opts.maxPv ?? 8));
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? 1));
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 1500));

  // Walk listing pages, accumulating UNIQUE detail links until we hit maxPv or
  // run out of pages. Dedup on detailUrl because the portal re-surfaces the
  // same consultation across pages during re-issues. Mirrors result.crawler.
  const all: ReturnType<typeof extractDetailLinks> = [];
  const seen = new Set<string>();
  const first = await deps.search();
  let baseUrl = first.baseUrl;
  let pageHtml = first.listingHtml;
  for (let page = 1; page <= maxPages; page += 1) {
    for (const link of extractDetailLinks(pageHtml, baseUrl)) {
      if (seen.has(link.detailUrl)) continue;
      seen.add(link.detailUrl);
      all.push(link);
      if (all.length >= maxPv) break;
    }
    if (all.length >= maxPv || page === maxPages || !deps.nextPage) break;
    const next = await deps.nextPage();
    if (!next) break;
    baseUrl = next.baseUrl;
    pageHtml = next.listingHtml;
  }
  const links = all;

  let notices = 0;
  let pvRead = 0;
  let bidsStored = 0;
  let errors = 0;

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]!;
    try {
      const detail = await deps.fetchDetail(link.detailUrl);
      const avisUrl = extractAvisDownloadUrl(detail, link.detailUrl);
      if (!avisUrl) continue;
      notices += 1;
      const reference = parseDetailPage(detail).reference;
      if (!reference) continue;

      const bytes = await deps.fetchAvisBytes(avisUrl);
      const pvText = await deps.extractAvisText(bytes);
      const pv = parseExtraitPvJson(pvText);
      // Unparseable after a successful vision read = likely truncation/garbage;
      // count it (don't let the richest, longest PVs vanish silently).
      if (!pv) {
        errors += 1;
        continue;
      }
      if (!pv.lisible || pv.soumissionnaires.length === 0) continue;
      pvRead += 1;

      const buyerName = pv.acheteur ?? UNKNOWN_BUYER_LABEL;
      const resultDate = deps.now();
      for (const bidder of pv.soumissionnaires) {
        await deps.storeBid({
          reference,
          buyerName,
          bidderName: bidder.name,
          amountMad: bidder.montantMad,
          estimationMad: pv.estimationMad,
          objet: pv.objet,
          isWinner: bidder.isWinner,
          resultDate,
          sourceUrl: link.detailUrl,
        });
        bidsStored += 1;
      }
    } catch {
      errors += 1;
    }
    if (delayMs > 0 && i < links.length - 1) await deps.sleep(delayMs);
  }

  return { pvFound: links.length, notices, pvRead, bidsStored, errors };
}

/**
 * Wires the PV crawl to the live portal (stateful PRADO search, annonceType=5),
 * an OCR pass over the scanned PV bytes (ocrmypdf in the sidecar), a text LLM
 * (T1/haiku) for the JSON extraction, and the intel repository (upserts every
 * bidder). Bounded + polite. The vision-LLM path was abandoned after every
 * provider rejected the PMP avis bytes ("unsupported image" / "Could not
 * process image").
 */
@Injectable()
export class ExtraitPvCrawlerService {
  private readonly logger = new Logger('PvCrawler');

  constructor(
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
  ) {}

  async crawlOnce(opts: PvCrawlOptions = {}): Promise<PvCrawlSummary> {
    const llm = this.llm;
    if (!llm) {
      throw new ServiceUnavailableException(
        'LLM requis pour lire les extraits de PV (LLM_API_KEY manquant)',
      );
    }
    const searchUrl =
      process.env.PV_SEARCH_URL ??
      process.env.RESULT_SEARCH_URL ??
      DEFAULT_SEARCH_URL;
    let cookie = '';
    // PRADO state captured by search() and refreshed by each nextPage(): the
    // ~100KB PRADO_PAGESTATE + the "Aller à la page suivante" postback target
    // for the PV listing pager. Replayed verbatim on every postback. Mirrors
    // ResultCrawlerService — the pager that lets the harvest exceed page 1.
    let lastFields: Record<string, string> | null = null;
    let nextTarget: string | null = null;

    const captureNext = (html: string): void => {
      lastFields = parseFormInputs(html);
      const m = /<a id="([^"]+)"[^>]*>\s*<img[^>]*Aller à la page suivante/i.exec(html);
      if (!m) {
        nextTarget = null;
        return;
      }
      const id = m[1]!;
      const sample = Object.keys(lastFields).find((n) => n.includes('$resultSearch$'));
      const prefix = sample
        ? sample.slice(0, sample.indexOf('$resultSearch$') + '$resultSearch$'.length)
        : 'ctl0$CONTENU_PAGE$resultSearch$';
      const clientPrefix = prefix.replace(/\$/g, '_');
      const suffix = id.startsWith(clientPrefix) ? id.slice(clientPrefix.length) : id;
      nextTarget = prefix + suffix.replace(/_/g, '$');
    };

    const search = async (): Promise<{ listingHtml: string; baseUrl: string }> => {
      const formRes = await fetch(searchUrl, {
        headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(PORTAL_TIMEOUT),
      });
      cookie = cookieHeader(formRes.headers.getSetCookie());
      const body = buildResultSearchBody(await formRes.text(), ANNONCE_TYPE_EXTRAIT_PV);
      const postRes = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'User-Agent': PORTAL_UA,
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: searchUrl,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
        signal: AbortSignal.timeout(PORTAL_TIMEOUT),
      });
      const html = await postRes.text();
      captureNext(html);
      return { listingHtml: html, baseUrl: searchUrl };
    };

    const nextPage = async (): Promise<{ listingHtml: string; baseUrl: string } | null> => {
      if (!lastFields || !nextTarget) return null;
      const body = new URLSearchParams(lastFields);
      body.set('PRADO_POSTBACK_TARGET', nextTarget);
      body.set('PRADO_POSTBACK_PARAMETER', '');
      const res = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'User-Agent': PORTAL_UA,
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: searchUrl,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
        signal: AbortSignal.timeout(PORTAL_TIMEOUT),
      });
      if (!res.ok) return null;
      const html = await res.text();
      captureNext(html);
      return { listingHtml: html, baseUrl: searchUrl };
    };

    const summary = await crawlExtraitsPv(
      {
        search,
        nextPage,
        fetchDetail: (url) => fetchText(url, cookie),
        fetchAvisBytes: (url) => fetchAvisBytes(url, cookie),
        // OCR-first path: bytes → ocrmypdf (or pdf-parse for text-layer PDFs)
        // → T1/haiku over text. The vision endpoints rejected the raw PMP avis
        // bytes (TIFF / scanned PDF) across providers, so we route through OCR.
        extractAvisText: async (bytes) => {
          const text = await ocrBytesToText(bytes);
          return (
            await llm.complete({
              tier: 'T1',
              prompt: `${EXTRAIT_PV_VISION_PROMPT}\n\n--- TEXTE EXTRAIT DU PV (OCR) ---\n${text.slice(0, 12000)}`,
              // A bidder-rich PV serializes long; headroom so it is never truncated
              // (output tokens are billed only when generated → short PVs cost the same).
              maxTokens: 2500,
            })
          ).text;
        },
        storeBid: (b) => this.store(b),
        sleep: sleepMs,
        now: () => new Date(),
      },
      opts,
    );
    this.logger.log(`pv crawl complete ${JSON.stringify(summary)}`);
    return summary;
  }

  private async store(b: StoredPvBid): Promise<'inserted' | 'updated'> {
    const competitor = await this.intel.upsertCompetitor(b.bidderName);
    return this.intel.upsertResult(
      {
        reference: b.reference,
        buyerName: b.buyerName,
        bidderName: b.bidderName,
        amountMad: b.amountMad ?? undefined,
        estimationMad: b.estimationMad ?? undefined,
        objet: b.objet ?? undefined,
        isWinner: b.isWinner,
        resultDate: b.resultDate,
        sourceUrl: b.sourceUrl,
      },
      competitor.id,
    );
  }
}
