import { readFile } from 'node:fs/promises';
import { parseFormInputs } from './prado';

export interface PortalPage {
  html: string;
  sourceUrl: string;
}

/**
 * Abstraction over where portal HTML comes from (live HTTP vs recorded
 * fixture). `page` is 1-based; sources that cannot paginate ignore it and
 * return the same content, which the Sentinel detects (repeated fingerprint)
 * and treats as the end of the result set.
 */
export interface PortalSource {
  fetch(page?: number): Promise<PortalPage>;
}

export const PORTAL_SOURCE = Symbol('PORTAL_SOURCE');

/** Dev/test source reading a recorded snapshot from disk (single page). */
export class FixturePortalSource implements PortalSource {
  constructor(
    private readonly filePath: string,
    private readonly sourceUrl = 'https://www.marchespublics.gov.ma/',
  ) {}

  async fetch(_page = 1): Promise<PortalPage> {
    const html = await readFile(this.filePath, 'utf8');
    return { html, sourceUrl: this.sourceUrl };
  }
}

export interface HttpPortalOptions {
  /** Total attempts before giving up (default 3). */
  attempts?: number;
  /** Base backoff in ms; doubles each retry (default 1500). */
  backoffMs?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Query parameter that carries the 1-based page index (Atexo MPE). When
   * unset the source is single-page: every page request returns the base URL,
   * so the Sentinel stops after one fetch. Confirm the live name against the
   * portal before enabling deep crawling.
   */
  pageParam?: string;
  /** Page index the portal uses for the first page (default 1). */
  firstPageIndex?: number;
  /** Optional results-per-page parameter and value, appended once. */
  pageSizeParam?: string;
  pageSize?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Live source — a polite GET with an honest User-Agent, hard timeout, and a
 * bounded retry with exponential backoff. Government portals drop requests;
 * a transient failure should not abort the whole Sentinel run. After the
 * final attempt the error propagates so coverage records the miss.
 *
 * Pagination is opt-in via `pageParam`/`pageSize`: the URL is rebuilt per
 * page so the Sentinel can walk the full result set instead of the portal's
 * small default first page.
 */
export class HttpPortalSource implements PortalSource {
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pageParam?: string;
  private readonly firstPageIndex: number;
  private readonly pageSizeParam?: string;
  private readonly pageSize?: number;

  constructor(
    private readonly url: string,
    options: HttpPortalOptions = {},
  ) {
    // Fail fast on a misconfigured portal URL instead of at first fetch.
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`Portal URL must be http(s): ${url}`);
    }
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.backoffMs = options.backoffMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.pageParam = options.pageParam;
    this.firstPageIndex = Number.isFinite(options.firstPageIndex)
      ? (options.firstPageIndex as number)
      : 1;
    this.pageSizeParam = options.pageSizeParam;
    this.pageSize = options.pageSize;
  }

  /** Builds the per-page URL, preserving the portal's existing query string. */
  buildPageUrl(page: number): string {
    if (!this.pageParam && !this.pageSizeParam) return this.url;
    const target = new URL(this.url);
    if (this.pageSizeParam && this.pageSize && Number.isFinite(this.pageSize)) {
      target.searchParams.set(this.pageSizeParam, String(this.pageSize));
    }
    if (this.pageParam) {
      const index = this.firstPageIndex + (page - 1);
      // Never emit "=NaN" to the portal on a misconfiguration.
      if (!Number.isFinite(index)) return this.url;
      target.searchParams.set(this.pageParam, String(index));
    }
    return target.toString();
  }

  async fetch(page = 1): Promise<PortalPage> {
    const url = this.buildPageUrl(page);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts) {
          await this.sleep(this.backoffMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Portal fetch failed');
  }

  private async fetchOnce(url: string): Promise<PortalPage> {
    const response = await this.fetchImpl(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Portal fetch failed: HTTP ${response.status}`);
    }
    return { html: await response.text(), sourceUrl: url };
  }
}

const USER_AGENT =
  'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)';

/**
 * Resolves the PRADO postback target for the "next page" pager link. PRADO
 * client ids replace the control-name "$" separators with "_", which is
 * ambiguous when a naming-container segment itself contains "_" (CONTENU_PAGE).
 * We rebuild the target from a known control-name prefix instead of blindly
 * swapping every "_".
 */
function findNextPageTarget(
  html: string,
  fields: Record<string, string>,
): string | null {
  const id = /<a id="([^"]+)"[^>]*>\s*<img[^>]*Aller à la page suivante/i.exec(
    html,
  )?.[1];
  if (!id) return null;
  const sample = Object.keys(fields).find((n) => n.includes('$resultSearch$'));
  const namePrefix = sample
    ? sample.slice(0, sample.indexOf('$resultSearch$') + '$resultSearch$'.length)
    : 'ctl0$CONTENU_PAGE$resultSearch$';
  const clientPrefix = namePrefix.replace(/\$/g, '_');
  const suffix = id.startsWith(clientPrefix) ? id.slice(clientPrefix.length) : id;
  return namePrefix + suffix.replace(/_/g, '$');
}

/**
 * The Atexo result pager's "rows per page" select. Switching it to 500 turns
 * the 99 642-row `&AllCons` consultation archive from 9 965 pages (10/page)
 * into ~200 — the deep archive is reachable in a few minutes of polite hops
 * instead of thousands, and without any (non-functional) date-window filtering.
 */
const PAGE_SIZE_FIELD = 'ctl0$CONTENU_PAGE$resultSearch$listePageSizeTop';

export interface PradoPortalOptions {
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * When set, the source switches the result pager to this many rows per page
   * on the first hop (a `listePageSizeTop` postback) before walking the
   * next-pager. Opt-in: unset preserves the portal's default 10/page. The
   * postback is skipped when the listing carries no size control.
   */
  pageSize?: number;
}

/**
 * Live source for Atexo MPE / PRADO portals (marchespublics.gov.ma), whose
 * result pager is a stateful POST, NOT a GET parameter: the page is advanced
 * by re-submitting the form with PRADO_PAGESTATE + PRADO_POSTBACK_TARGET set
 * to the "next page" pager control. State (the ~100 KB PRADO_PAGESTATE and all
 * form inputs) is captured from each response and carried into the next hop.
 *
 * The Sentinel walks pages by calling fetch(1), fetch(2), … in order; this
 * source treats every call after the first as one postback "next".
 */
export class PradoPortalSource implements PortalSource {
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pageSize?: number;
  private fields: Record<string, string> | null = null;
  private nextTarget: string | null = null;
  /** Running `Cookie:` header; the portal's session is replayed across hops. */
  private cookie = '';

  constructor(
    private readonly url: string,
    options: PradoPortalOptions = {},
  ) {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`Portal URL must be http(s): ${url}`);
    }
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.backoffMs = options.backoffMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.pageSize =
      Number.isFinite(options.pageSize) && (options.pageSize as number) > 0
        ? Math.floor(options.pageSize as number)
        : undefined;
  }

  async fetch(page = 1): Promise<PortalPage> {
    if (page <= 1 || !this.fields) {
      let html = await this.requestWithRetry('GET');
      this.capture(html);
      // One-time page-size switch: fewer, larger pages ⇒ far fewer polite hops
      // to cover the whole catalogue. Only when the listing exposes the control
      // (guards non-listing pages) and a target size was requested.
      if (this.pageSize && this.fields && html.includes('listePageSizeTop')) {
        const body = new URLSearchParams(this.fields);
        body.set(PAGE_SIZE_FIELD, String(this.pageSize));
        body.set('PRADO_POSTBACK_TARGET', PAGE_SIZE_FIELD);
        body.set('PRADO_POSTBACK_PARAMETER', '');
        html = await this.requestWithRetry('POST', body);
        this.capture(html);
      }
      return { html, sourceUrl: this.url };
    }
    // No "next" link on the last page → an empty page ends the walk cleanly.
    if (!this.nextTarget) {
      return { html: '<html><body></body></html>', sourceUrl: this.pageUrl(page) };
    }
    const body = new URLSearchParams(this.fields);
    body.set('PRADO_POSTBACK_TARGET', this.nextTarget);
    body.set('PRADO_POSTBACK_PARAMETER', '');
    const html = await this.requestWithRetry('POST', body);
    this.capture(html);
    return { html, sourceUrl: this.pageUrl(page) };
  }

  /** Stable per-page key so cross-run change detection works per page. */
  private pageUrl(page: number): string {
    return `${this.url}#page=${page}`;
  }

  private capture(html: string): void {
    this.fields = parseFormInputs(html);
    this.nextTarget = findNextPageTarget(html, this.fields);
  }

  /**
   * Merge the response's Set-Cookie batch into the running jar (later values for
   * the same NAME win), so the PRADO session — and the WAF challenge cookie —
   * ride along on every subsequent hop, exactly as a browser would. Guarded so
   * test doubles without a real Headers object are a no-op.
   */
  private absorbCookies(response: Response): void {
    const setCookies =
      typeof response.headers?.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    if (setCookies.length === 0) return;
    const jar = new Map<string, string>();
    const addPair = (raw: string): void => {
      const pair = raw.split(';')[0]?.trim() ?? '';
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    };
    if (this.cookie) for (const pair of this.cookie.split('; ')) addPair(pair);
    for (const raw of setCookies) addPair(raw);
    this.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private async requestWithRetry(
    method: 'GET' | 'POST',
    body?: URLSearchParams,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.url, {
          method,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html',
            ...(this.cookie ? { Cookie: this.cookie } : {}),
            ...(method === 'POST'
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Referer: this.url,
                }
              : {}),
          },
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`Portal fetch failed: HTTP ${response.status}`);
        }
        this.absorbCookies(response);
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts) {
          await this.sleep(this.backoffMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Portal fetch failed');
  }
}
