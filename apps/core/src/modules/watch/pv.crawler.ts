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
import { UNKNOWN_BUYER_LABEL } from '../intel/rebate.domain';
import { extractDetailLinks, parseDetailPage } from './detail.parser';
import { ANNONCE_TYPE_EXTRAIT_PV, extractAvisDownloadUrl } from './result.parser';
import { EXTRAIT_PV_VISION_PROMPT, parseExtraitPvJson } from './pv.parser';
import {
  DEFAULT_SEARCH_URL,
  fetchImage,
  fetchText,
  pradoResultSearch,
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
  fetchDetail: (url: string) => Promise<string>;
  fetchImage: (url: string) => Promise<{ base64: string; mediaType: LlmImageMediaType }>;
  visionExtract: (base64: string, mediaType: LlmImageMediaType) => Promise<string>;
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
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 1500));

  const { listingHtml, baseUrl } = await deps.search();
  const links = extractDetailLinks(listingHtml, baseUrl).slice(0, maxPv);

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

      const img = await deps.fetchImage(avisUrl);
      const visionText = await deps.visionExtract(img.base64, img.mediaType);
      const pv = parseExtraitPvJson(visionText);
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
 * the vision LLM (reads the scanned PV extracts), and the intel repository
 * (upserts every bidder). Bounded + polite. Each PV costs one vision call.
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
        'LLM vision requis pour lire les extraits de PV (LLM_API_KEY manquant)',
      );
    }
    const searchUrl =
      process.env.PV_SEARCH_URL ??
      process.env.RESULT_SEARCH_URL ??
      DEFAULT_SEARCH_URL;
    let cookie = '';

    const summary = await crawlExtraitsPv(
      {
        search: async () => {
          const res = await pradoResultSearch(searchUrl, ANNONCE_TYPE_EXTRAIT_PV);
          cookie = res.cookie;
          return { listingHtml: res.listingHtml, baseUrl: res.baseUrl };
        },
        fetchDetail: (url) => fetchText(url, cookie),
        fetchImage: (url) => fetchImage(url, cookie),
        visionExtract: async (base64, mediaType) =>
          (
            await llm.completeVision({
              tier: 'T2',
              imageBase64: base64,
              mediaType,
              prompt: EXTRAIT_PV_VISION_PROMPT,
              // A bidder-rich PV serializes long; headroom so it is never truncated
              // (output tokens are billed only when generated → short PVs cost the same).
              maxTokens: 2500,
            })
          ).text,
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
