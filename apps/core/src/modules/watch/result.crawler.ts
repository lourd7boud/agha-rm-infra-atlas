import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LLM_CLIENT,
  type LlmClient,
  type LlmImageMediaType,
} from '../brain/llm.client';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import { extractDetailLinks, parseDetailPage } from './detail.parser';
import {
  buildResultSearchBody,
  extractAvisDownloadUrl,
  parseResultNoticeJson,
} from './result.parser';

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
}

export interface StoredResult {
  reference: string;
  buyerName: string;
  bidderName: string;
  amountMad: number | null;
  resultDate: Date;
  sourceUrl: string;
}

export interface ResultCrawlDeps {
  /** GET the search form + POST the result filter → the result listing. */
  search: () => Promise<{ listingHtml: string; baseUrl: string }>;
  fetchDetail: (url: string) => Promise<string>;
  fetchImage: (url: string) => Promise<{ base64: string; mediaType: LlmImageMediaType }>;
  visionExtract: (base64: string, mediaType: LlmImageMediaType) => Promise<string>;
  storeResult: (r: StoredResult) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export const RESULT_VISION_PROMPT =
  "Ceci est un avis de résultat définitif d'un marché public marocain (image scannée). " +
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
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 1200));

  const { listingHtml, baseUrl } = await deps.search();
  const links = extractDetailLinks(listingHtml, baseUrl).slice(0, maxResults);

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

      const img = await deps.fetchImage(avisUrl);
      const visionText = await deps.visionExtract(img.base64, img.mediaType);
      const notice = parseResultNoticeJson(visionText);
      if (!notice || !notice.lisible || !notice.attributaire) continue;
      extracted += 1;

      const ok = await deps.storeResult({
        reference,
        buyerName: notice.acheteur ?? 'Acheteur non précisé',
        bidderName: notice.attributaire,
        amountMad: notice.montantMad,
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

function imageMediaType(contentType: string | null): LlmImageMediaType {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('png')) return 'image/png';
  if (ct.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Wires the result crawl to the live portal (stateful PRADO search via a session
 * cookie), the vision LLM (reads the scanned notices) and the intel repository
 * (stores winners). Bounded + polite. Each notice costs one vision call.
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
        'LLM vision requis pour lire les avis de résultat (LLM_API_KEY manquant)',
      );
    }
    const searchUrl = process.env.RESULT_SEARCH_URL ?? DEFAULT_SEARCH_URL;
    let cookie = '';

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
      return { listingHtml: await postRes.text(), baseUrl: searchUrl };
    };

    const summary = await crawlResults(
      {
        search,
        fetchDetail: (url) => this.fetchText(url, cookie),
        fetchImage: (url) => this.fetchImage(url, cookie),
        visionExtract: async (base64, mediaType) =>
          (
            await llm.completeVision({
              tier: 'T2',
              imageBase64: base64,
              mediaType,
              prompt: RESULT_VISION_PROMPT,
              maxTokens: 500,
            })
          ).text,
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

  private async fetchImage(
    url: string,
    cookie: string,
  ): Promise<{ base64: string; mediaType: LlmImageMediaType }> {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mediaType: imageMediaType(res.headers.get('content-type')),
    };
  }
}
