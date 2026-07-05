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
  isBlockStatus,
  jitter,
  mergeCookieHeaders,
  PORTAL_BLOCK_THRESHOLD,
  PORTAL_TIMEOUT,
  PORTAL_UA,
  PortalBlockedError,
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
  /** True when a portal block / consecutive-failure run halted the batch early. */
  stoppedEarly?: boolean;
}

export interface PvCrawlOptions {
  maxPv?: number;
  delayMs?: number;
  /** Injectable RNG for delay jitter (default Math.random). */
  random?: () => number;
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
  /** Injectable RNG for delay jitter (default Math.random). */
  random?: () => number;
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
  const random = deps.random ?? opts.random ?? Math.random;

  let notices = 0;
  let pvRead = 0;
  let bidsStored = 0;
  let errors = 0;
  // Circuit breaker: a portal block (429/403) or a run of consecutive fetch
  // failures halts the batch instead of firing the rest into a live ban.
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  const empty = (): PvCrawlSummary => ({
    pvFound: 0,
    notices,
    pvRead,
    bidsStored,
    errors,
    stoppedEarly: true,
  });

  // Walk listing pages, accumulating UNIQUE detail links until we hit maxPv or
  // run out of pages. Dedup on detailUrl because the portal re-surfaces the
  // same consultation across pages during re-issues. Mirrors result.crawler.
  const all: ReturnType<typeof extractDetailLinks> = [];
  const seen = new Set<string>();
  let first: { listingHtml: string; baseUrl: string };
  try {
    first = await deps.search();
  } catch (err) {
    if (err instanceof PortalBlockedError) {
      errors += 1;
      return empty();
    }
    throw err;
  }
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
    if (delayMs > 0) await deps.sleep(jitter(delayMs, random));
    let next: { listingHtml: string; baseUrl: string } | null;
    try {
      next = await deps.nextPage();
    } catch (err) {
      if (err instanceof PortalBlockedError) {
        stoppedEarly = true;
        break;
      }
      throw err;
    }
    if (!next) break;
    baseUrl = next.baseUrl;
    pageHtml = next.listingHtml;
  }
  const links = all;

  for (let i = 0; i < links.length && !stoppedEarly; i += 1) {
    const link = links[i]!;
    let detail: string;
    try {
      detail = await deps.fetchDetail(link.detailUrl);
      consecutiveFailures = 0;
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

    // detail fetched OK. Process (avis download → OCR/LLM → store). A portal
    // block on the avis download still breaks; parse/LLM/DB errors just count.
    try {
      const avisUrl = extractAvisDownloadUrl(detail, link.detailUrl);
      if (avisUrl) {
        notices += 1;
        const reference = parseDetailPage(detail).reference;
        if (reference) {
          const bytes = await deps.fetchAvisBytes(avisUrl);
          const pvText = await deps.extractAvisText(bytes);
          const pv = parseExtraitPvJson(pvText);
          // Unparseable after a successful read = likely truncation/garbage;
          // count it (don't let the richest, longest PVs vanish silently).
          if (!pv) {
            errors += 1;
          } else if (pv.lisible && pv.soumissionnaires.length > 0) {
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
          }
        }
      }
    } catch (err) {
      errors += 1;
      if (err instanceof PortalBlockedError) {
        stoppedEarly = true;
        break;
      }
    }
    if (delayMs > 0 && i < links.length - 1) await deps.sleep(jitter(delayMs, random));
  }

  return {
    pvFound: links.length,
    notices,
    pvRead,
    bidsStored,
    errors,
    ...(stoppedEarly ? { stoppedEarly: true } : {}),
  };
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
      if (isBlockStatus(formRes.status)) throw new PortalBlockedError(formRes.status);
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
      if (isBlockStatus(postRes.status)) throw new PortalBlockedError(postRes.status);
      // Absorb any rotated PRADO/WAF cookie from the POST so the pager stays in
      // the same session (a stale cookie can itself trigger a 403 mid-walk).
      cookie = mergeCookieHeaders(cookie, postRes.headers.getSetCookie());
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
      if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
      if (!res.ok) return null;
      cookie = mergeCookieHeaders(cookie, res.headers.getSetCookie());
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
