import type { LlmImageMediaType } from '../brain/llm.client';
import { buildResultSearchBody } from './result.parser';

/**
 * Shared live-portal HTTP plumbing for the result/PV crawlers (Atexo MPE).
 * Politeness headers, session-cookie handling, the stateful PRADO result search,
 * and the scanned-image download — one place, reused by every result-stage crawl.
 */

export const PORTAL_UA =
  'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)';
export const PORTAL_TIMEOUT = 40_000;
export const DEFAULT_SEARCH_URL =
  'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch';

export const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A hard rate-limit / block response (HTTP 429 or 403) from the portal or its
 * WAF. Distinct from a transient error: the caller must STOP, not retry —
 * hammering a live block deepens the ban. Shared by every result-stage crawler.
 */
export class PortalBlockedError extends Error {
  constructor(readonly status: number) {
    super(`Portal blocked the request: HTTP ${status}`);
    this.name = 'PortalBlockedError';
  }
}

/** 429/403 = the portal is throttling/blocking us (not a transient glitch). */
export function isBlockStatus(status: number): boolean {
  return status === 429 || status === 403;
}

/**
 * Consecutive fetch failures that mean the portal is blocking/down → a batch
 * crawler must stop rather than fire the rest of its backlog into the block.
 */
export const PORTAL_BLOCK_THRESHOLD = 5;

/**
 * Randomize a base delay ±40% (uniform in [0.6, 1.4]×) so a long backlog drain
 * doesn't emit a fixed inter-request interval — the single most common
 * behavioural bot signal a WAF scores on. `random() === 0.5` ⇒ exactly base.
 */
export function jitter(baseMs: number, random: () => number = Math.random): number {
  return Math.round(baseMs * (0.6 + random() * 0.8));
}

export function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
}

/**
 * Merge a running `Cookie:` header string with a fresh Set-Cookie batch,
 * preserving jar semantics: later values for the same NAME overwrite earlier
 * ones. Fixes the PMMP login flow where our naive concat sent BOTH the
 * anonymous PHPSESSID (from the GET) and the authenticated PHPSESSID (from
 * the 302 Set-Cookie) — PMMP read the first one and kept the caller anonymous.
 */
export function mergeCookieHeaders(
  existingHeader: string,
  setCookies: readonly string[],
): string {
  const jar = new Map<string, string>();
  const addPair = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) return;
    jar.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  };
  if (existingHeader) for (const pair of existingHeader.split(';')) addPair(pair);
  for (const raw of setCookies) addPair(raw.split(';')[0] ?? '');
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function imageMediaType(contentType: string | null): LlmImageMediaType {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('png')) return 'image/png';
  if (ct.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function fetchText(url: string, cookie: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': PORTAL_UA,
      Accept: 'text/html',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchImage(
  url: string,
  cookie: string,
): Promise<{ base64: string; mediaType: LlmImageMediaType }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': PORTAL_UA, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    base64: buf.toString('base64'),
    mediaType: imageMediaType(res.headers.get('content-type')),
  };
}

/**
 * Downloads the raw avis bytes (PDF or scanned image) — the OCR-first successor
 * of fetchImage(). The Referer header mirrors what a browser sends from the
 * detail page; some Atexo instances 403 the download without it.
 */
export async function fetchAvisBytes(url: string, cookie: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': PORTAL_UA,
      Referer: DEFAULT_SEARCH_URL,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface PortalSearchResult {
  listingHtml: string;
  baseUrl: string;
  /** Session cookie captured on the GET, to reuse for the follow-up fetches. */
  cookie: string;
}

/**
 * GET the advanced-search form, capture the PRADO session cookie, then POST the
 * form with the given annonceType filter ('4' résultat définitif, '5' extrait de
 * PV). Returns the result listing plus the cookie for the detail/image fetches.
 */
export async function pradoResultSearch(
  searchUrl: string,
  annonceType: string,
): Promise<PortalSearchResult> {
  const formRes = await fetch(searchUrl, {
    headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  if (isBlockStatus(formRes.status)) throw new PortalBlockedError(formRes.status);
  const cookie = cookieHeader(formRes.headers.getSetCookie());
  const body = buildResultSearchBody(await formRes.text(), annonceType);
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
  return { listingHtml: await postRes.text(), baseUrl: searchUrl, cookie };
}
