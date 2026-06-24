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
  buildResultSearchBody,
  extractAvisDownloadUrl,
  parseResultNoticeJson,
} from './result.parser';
import { parseFormInputs } from './prado';

export interface ResultCrawlSummary {
  resultsFound: number;
  notices: number;
  extracted: number;
  stored: number;
  errors: number;
}

export interface ResultCrawlOptions {
  maxResults?: number;
  delayMs?: number;
  /**
   * Number of Résultats listing pages to walk (PRADO postback "next"). 1 means
   * the current behaviour (first page only — the historical bottleneck that
   * starved the catalogue). Default 5 widens the harvest without flooding the
   * portal in one sweep.
   */
  maxPages?: number;
}

export interface StoredResult {
  reference: string;
  buyerName: string;
  bidderName: string;
  amountMad: number | null;
  estimationMad: number | null;
  objet: string | null;
  resultDate: Date;
  sourceUrl: string;
}

export interface ResultCrawlDeps {
  /** GET the search form + POST the result filter → the first result listing page. */
  search: () => Promise<{ listingHtml: string; baseUrl: string }>;
  /**
   * Optional: PRADO postback to advance to the next page of the Résultats
   * listing (uses the cookie + PRADO_PAGESTATE captured by search). Returns the
   * next page's HTML, or null when there are no more pages.
   */
  nextPage?: () => Promise<{ listingHtml: string; baseUrl: string } | null>;
  fetchDetail: (url: string) => Promise<string>;
  /** Download the avis bytes (PDF or scanned image) from the portal. */
  fetchAvisBytes: (url: string) => Promise<Uint8Array>;
  /** Turn those bytes into the LLM-parseable JSON string for parseResultNoticeJson. */
  extractAvisText: (bytes: Uint8Array) => Promise<string>;
  storeResult: (r: StoredResult) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export const RESULT_VISION_PROMPT =
  "Ceci est un avis de résultat définitif d'un marché public marocain (avis scanné, texte OCR fourni). " +
  'Extrais STRICTEMENT en JSON, sans aucun texte autour: ' +
  '{"attributaire": raison sociale du soumissionnaire retenu (string) ou null, ' +
  '"acheteur": maître d\'ouvrage / acheteur public ou null, ' +
  '"montant_attribue_mad": montant de l\'attribution en dirhams — lis avec PRÉCISION ' +
  'la virgule décimale; les espaces sont des séparateurs de milliers, PAS la virgule ' +
  '(ex: "1 177 913,89" = 1177913.89, surtout pas un milliard) (number) ou null, ' +
  '"estimation_mad": estimation administrative si présente (number) ou null, ' +
  '"objet": objet du marché (court) ou null, ' +
  '"lisible": true si l\'image est lisible sinon false}.';

/**
 * Stage-3 result crawl (pure orchestrator). Submit the result search, walk the
 * attributed consultations, download each scanned result notice, read it with a
 * vision LLM, and store the winner + amount. Deps are injected so this is
 * unit-testable without HTTP, a vision model, or a database.
 */
export async function crawlResults(
  deps: ResultCrawlDeps,
  opts: ResultCrawlOptions = {},
): Promise<ResultCrawlSummary> {
  const maxResults = Math.max(0, Math.floor(opts.maxResults ?? 12));
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? 1));
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 1200));

  // Walk pages, accumulating UNIQUE detail links until we either hit maxResults
  // or run out of pages. Dedup on detailUrl because the portal sometimes
  // surfaces the same consultation on multiple pages during a re-issue.
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
      if (all.length >= maxResults) break;
    }
    if (all.length >= maxResults || page === maxPages || !deps.nextPage) break;
    const next = await deps.nextPage();
    if (!next) break;
    baseUrl = next.baseUrl;
    pageHtml = next.listingHtml;
  }
  const links = all;

  let notices = 0;
  let extracted = 0;
  let stored = 0;
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
      const noticeText = await deps.extractAvisText(bytes);
      const notice = parseResultNoticeJson(noticeText);
      if (!notice || !notice.lisible || !notice.attributaire) continue;
      extracted += 1;

      const ok = await deps.storeResult({
        reference,
        buyerName: notice.acheteur ?? UNKNOWN_BUYER_LABEL,
        bidderName: notice.attributaire,
        amountMad: notice.montantMad,
        estimationMad: notice.estimationMad,
        objet: notice.objet,
        resultDate: deps.now(),
        sourceUrl: link.detailUrl,
      });
      if (ok) stored += 1;
    } catch {
      errors += 1;
    }
    if (delayMs > 0 && i < links.length - 1) await deps.sleep(delayMs);
  }

  return { resultsFound: links.length, notices, extracted, stored, errors };
}

// NOTE: portal-fetch.ts is the shared successor of the helpers below
// (UA/TIMEOUT/DEFAULT_SEARCH_URL, cookieHeader, fetchText, pradoResultSearch).
// Kept duplicated here deliberately to avoid regressing the live result crawler
// — keep both in sync, or migrate this file onto portal-fetch once the PV
// crawler is validated in production.
const UA = 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)';
const TIMEOUT = 40_000;
const DEFAULT_SEARCH_URL =
  'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch';
const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
}

/**
 * Wires the result crawl to the live portal (stateful PRADO search via a session
 * cookie), an OCR pass over the scanned avis bytes (ocrmypdf in the sidecar)
 * and a text LLM (T1/haiku) for the JSON extraction. The vision-LLM path was
 * abandoned after every provider rejected the PMP avis bytes ("unsupported
 * image" / "Could not process image") — the bytes are typically TIFF or scanned
 * PDF, neither of which the OpenRouter vision endpoints accept.
 */
@Injectable()
export class ResultCrawlerService {
  private readonly logger = new Logger('ResultCrawler');

  constructor(
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
  ) {}

  async crawlOnce(opts: ResultCrawlOptions = {}): Promise<ResultCrawlSummary> {
    const llm = this.llm;
    if (!llm) {
      throw new ServiceUnavailableException(
        'LLM requis pour lire les avis de résultat (LLM_API_KEY manquant)',
      );
    }
    const searchUrl = process.env.RESULT_SEARCH_URL ?? DEFAULT_SEARCH_URL;
    let cookie = '';
    // PRADO state captured by search() and updated by each nextPage(): the
    // ~100KB PRADO_PAGESTATE + the "Aller à la page suivante" postback target
    // for the result-listing pager. Replayed verbatim every postback.
    let lastFields: Record<string, string> | null = null;
    let nextTarget: string | null = null;

    const captureNext = (html: string): void => {
      lastFields = parseFormInputs(html);
      // Standard Atexo MPE "next page" pager control id — same shape the
      // listing crawler uses (CONTENU_PAGE + resultSearch + pager step).
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
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      cookie = cookieHeader(formRes.headers.getSetCookie());
      const body = buildResultSearchBody(await formRes.text());
      const postRes = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: searchUrl,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT),
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
          'User-Agent': UA,
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: searchUrl,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) return null;
      const html = await res.text();
      captureNext(html);
      return { listingHtml: html, baseUrl: searchUrl };
    };

    const summary = await crawlResults(
      {
        search,
        nextPage,
        fetchDetail: (url) => this.fetchText(url, cookie),
        fetchAvisBytes: (url) => this.fetchAvisBytes(url, cookie),
        // OCR-first path: pdf-parse → ocrmypdf for scans → T1/haiku over text.
        // The three vision providers (gpt-4o / gemini / sonnet) all rejected
        // the raw PMP avis bytes ("unsupported image", "Could not process
        // image"), so we route through OCR and feed text to a text model.
        extractAvisText: async (bytes) => {
          const text = await ocrBytesToText(bytes);
          return (
            await llm.complete({
              tier: 'T1',
              prompt: `${RESULT_VISION_PROMPT}\n\n--- TEXTE EXTRAIT DE L'AVIS (OCR) ---\n${text.slice(0, 8000)}`,
              maxTokens: 500,
            })
          ).text;
        },
        storeResult: (r) => this.store(r),
        sleep: sleepMs,
        now: () => new Date(),
      },
      opts,
    );
    this.logger.log(`result crawl complete ${JSON.stringify(summary)}`);
    return summary;
  }

  private async store(r: StoredResult): Promise<boolean> {
    const competitor = await this.intel.upsertCompetitor(r.bidderName);
    return this.intel.insertResult(
      {
        reference: r.reference,
        buyerName: r.buyerName,
        bidderName: r.bidderName,
        amountMad: r.amountMad ?? undefined,
        estimationMad: r.estimationMad ?? undefined,
        objet: r.objet ?? undefined,
        isWinner: true,
        resultDate: r.resultDate,
        sourceUrl: r.sourceUrl,
      },
      competitor.id,
    );
  }

  private async fetchText(url: string, cookie: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  private async fetchAvisBytes(url: string, cookie: string): Promise<Uint8Array> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        // Referer mirrors what a browser sends on the detail page → some
        // Atexo instances 403 the download without it.
        Referer: DEFAULT_SEARCH_URL,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
