import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTICE_REPOSITORY,
  type NoticeRepository,
} from '../intel/notice.repository';
import { ocrBytesToText } from '../tender/pdf-ocr';
import { extractDetailLinks, parseDetailPage, type DetailLink } from './detail.parser';
import { buildResultSearchBody, extractAvisDownloadUrl } from './result.parser';
import { parseFormInputs } from './prado';
import {
  cookieHeader,
  DEFAULT_SEARCH_URL,
  PORTAL_TIMEOUT,
  PORTAL_UA,
  sleepMs,
} from './portal-fetch';

/**
 * Notice ACQUISITION pipeline — the LLM-free half of the 129k-notice backfill.
 * Walks the Résultats listing (annonceType 4 or 5), downloads each notice,
 * OCRs it, and archives the text in intel.result_notice. Interpretation
 * (deterministic regex + LLM fallback) happens later, at budget pace, from
 * the archive — the portal is never asked for the same notice twice.
 */

/** Below this many normalized chars the OCR yielded nothing usable. */
const MIN_OCR_CHARS = 200;
const DEFAULT_OCR_CONCURRENCY = 3;

export interface NoticeArchiveSummary {
  pagesWalked: number;
  linksSeen: number;
  skippedKnown: number;
  acquired: number;
  empty: number;
  duplicates: number;
  errors: number;
}

export interface NoticeArchiveOptions {
  annonceType: '4' | '5';
  /** Cap on NEW notices archived this run (known links don't count). */
  maxNotices?: number;
  maxPages?: number;
  delayMs?: number;
  ocrConcurrency?: number;
}

export interface NoticeArchiveDeps {
  search: () => Promise<{ listingHtml: string; baseUrl: string }>;
  nextPage?: () => Promise<{ listingHtml: string; baseUrl: string } | null>;
  extractLinks: (html: string, baseUrl: string) => DetailLink[];
  fetchDetail: (url: string) => Promise<string>;
  extractAvisUrl: (detailHtml: string, baseUrl: string) => string | null;
  parseReference: (detailHtml: string) => string | null;
  fetchAvisBytes: (url: string) => Promise<Uint8Array>;
  ocr: (bytes: Uint8Array) => Promise<string>;
  notices: NoticeRepository;
  sleep: (ms: number) => Promise<void>;
}

/** The portal's own notice id — the archive's idempotency key. */
export function idAvisFromUrl(avisUrl: string): string | null {
  const m = /idAvis=(\d+)/i.exec(avisUrl);
  return m ? (m[1] as string) : null;
}

/** Minimal counting semaphore for the OCR pool (OCR is the slow stage). */
function makeLimiter(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}

export async function archiveNotices(
  deps: NoticeArchiveDeps,
  opts: NoticeArchiveOptions,
): Promise<NoticeArchiveSummary> {
  const maxNotices = Math.max(1, Math.floor(opts.maxNotices ?? 100));
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? 10));
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? 900));
  const limiter = makeLimiter(
    Math.max(1, Math.floor(opts.ocrConcurrency ?? DEFAULT_OCR_CONCURRENCY)),
  );

  const summary: NoticeArchiveSummary = {
    pagesWalked: 0,
    linksSeen: 0,
    skippedKnown: 0,
    acquired: 0,
    empty: 0,
    duplicates: 0,
    errors: 0,
  };
  const ocrJobs: Array<Promise<void>> = [];
  const seenThisRun = new Set<string>();
  let newCount = 0;

  const first = await deps.search();
  let page = { html: first.listingHtml, baseUrl: first.baseUrl };

  for (let p = 1; p <= maxPages && newCount < maxNotices; p += 1) {
    summary.pagesWalked += 1;
    const links = deps
      .extractLinks(page.html, page.baseUrl)
      .filter((l) => !seenThisRun.has(l.detailUrl));
    links.forEach((l) => seenThisRun.add(l.detailUrl));
    summary.linksSeen += links.length;

    // One round-trip skip-list for the whole page — re-walked pages are cheap.
    const known = await deps.notices.knownSourceUrls(links.map((l) => l.detailUrl));
    const fresh = links.filter((l) => !known.has(l.detailUrl));
    summary.skippedKnown += links.length - fresh.length;

    for (const link of fresh) {
      if (newCount >= maxNotices) break;
      try {
        const detail = await deps.fetchDetail(link.detailUrl);
        const avisUrl = deps.extractAvisUrl(detail, link.detailUrl);
        const idAvis = avisUrl ? idAvisFromUrl(avisUrl) : null;
        if (!avisUrl || !idAvis) continue;
        const reference = deps.parseReference(detail);
        const bytes = await deps.fetchAvisBytes(avisUrl);
        newCount += 1;

        // OCR runs in a small pool — downloads stay sequential + polite while
        // the CPU-bound stage overlaps. Insert happens inside the job.
        ocrJobs.push(
          limiter(async () => {
            try {
              const text = await deps.ocr(bytes);
              const usable = text.replace(/\s+/g, ' ').trim();
              const isEmpty = usable.length < MIN_OCR_CHARS;
              const inserted = await deps.notices.insertAcquired({
                annonceType: opts.annonceType,
                idAvis,
                sourceUrl: link.detailUrl,
                reference: reference ?? undefined,
                ocrText: isEmpty ? undefined : text,
                bytesSize: bytes.byteLength,
                status: isEmpty ? 'empty' : 'acquired',
              });
              if (!inserted) summary.duplicates += 1;
              else if (isEmpty) summary.empty += 1;
              else summary.acquired += 1;
            } catch {
              summary.errors += 1;
            }
          }),
        );
      } catch {
        summary.errors += 1;
      }
      if (delayMs > 0) await deps.sleep(delayMs);
    }

    if (newCount >= maxNotices || p === maxPages || !deps.nextPage) break;
    const next = await deps.nextPage();
    if (!next) break;
    page = { html: next.listingHtml, baseUrl: next.baseUrl };
    if (delayMs > 0) await deps.sleep(delayMs);
  }

  await Promise.all(ocrJobs);
  return summary;
}

/**
 * Live-portal wiring — same stateful PRADO search + pager replay as the
 * result crawler (kept in sync deliberately; see the NOTE in result.crawler).
 */
@Injectable()
export class NoticeArchiveService {
  private readonly logger = new Logger('NoticeArchive');

  constructor(
    @Inject(NOTICE_REPOSITORY) private readonly notices: NoticeRepository,
  ) {}

  async acquireOnce(opts: NoticeArchiveOptions): Promise<NoticeArchiveSummary> {
    const searchUrl = process.env.RESULT_SEARCH_URL ?? DEFAULT_SEARCH_URL;
    let cookie = '';
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

    const post = async (body: string): Promise<string> => {
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    };

    const search = async (): Promise<{ listingHtml: string; baseUrl: string }> => {
      const formRes = await fetch(searchUrl, {
        headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(PORTAL_TIMEOUT),
      });
      cookie = cookieHeader(formRes.headers.getSetCookie());
      const html = await post(
        buildResultSearchBody(await formRes.text(), opts.annonceType),
      );
      captureNext(html);
      return { listingHtml: html, baseUrl: searchUrl };
    };

    const nextPage = async (): Promise<{ listingHtml: string; baseUrl: string } | null> => {
      if (!lastFields || !nextTarget) return null;
      const body = new URLSearchParams(lastFields);
      body.set('PRADO_POSTBACK_TARGET', nextTarget);
      body.set('PRADO_POSTBACK_PARAMETER', '');
      let html: string;
      try {
        html = await post(body.toString());
      } catch {
        return null;
      }
      captureNext(html);
      return { listingHtml: html, baseUrl: searchUrl };
    };

    const summary = await archiveNotices(
      {
        search,
        nextPage,
        extractLinks: extractDetailLinks,
        fetchDetail: (url) => this.fetchText(url, cookie),
        extractAvisUrl: extractAvisDownloadUrl,
        parseReference: (html) => parseDetailPage(html).reference ?? null,
        fetchAvisBytes: (url) => this.fetchBytes(url, cookie),
        ocr: ocrBytesToText,
        notices: this.notices,
        sleep: sleepMs,
      },
      opts,
    );
    this.logger.log(
      `notice acquisition (type ${opts.annonceType}) ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  private async fetchText(url: string, cookie: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': PORTAL_UA,
        Accept: 'text/html',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  private async fetchBytes(url: string, cookie: string): Promise<Uint8Array> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': PORTAL_UA,
        Referer: DEFAULT_SEARCH_URL,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
