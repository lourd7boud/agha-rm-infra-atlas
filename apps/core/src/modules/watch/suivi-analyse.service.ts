import { Injectable, Logger } from '@nestjs/common';
import {
  isBlockStatus,
  PORTAL_TIMEOUT,
  PORTAL_UA,
  PortalBlockedError,
} from './portal-fetch';
import {
  parseSuiviAnalyse,
  suiviTargetFromSourceUrl,
  type SuiviAnalyse,
} from './suivi-analyse';

/**
 * Live "Analyse du résultat" fetch — the marchecal.com/analyse.php flow, brought
 * in-house. Given a tender's portal sourceUrl, it GETs the public
 * "Suivre la commission" (SuiviConsultation) dépouillement page and parses the
 * full competitor field + the estimation MO, then computes the prix de référence
 * and the presumptive winner (see suivi-analyse.ts for the validated formula).
 *
 * The page is PUBLIC (no PMMP login needed — the same page the SuiviCrawler
 * harvests anonymously), so this is a single unauthenticated GET. Callers are
 * expected to cache the result briefly (the controller wraps it in a 60 s
 * TTL cache) so a burst of clicks stays polite to the portal.
 */
@Injectable()
export class SuiviAnalyseService {
  private readonly logger = new Logger(SuiviAnalyseService.name);

  /**
   * Fetch + analyse the dépouillement for one tender. Returns null when the
   * tender has no usable portal URL; throws PortalBlockedError on a 429/403 so
   * the caller can surface a "portal throttling" state instead of hammering.
   */
  async analyse(
    sourceUrl: string,
    estimationFallback?: number | null,
    fetchImpl: typeof fetch = fetch,
  ): Promise<SuiviAnalyse | null> {
    const target = suiviTargetFromSourceUrl(sourceUrl);
    if (!target) return null;
    const html = await this.fetchText(fetchImpl, target.url);
    return parseSuiviAnalyse(html, estimationFallback ?? null);
  }

  private async fetchText(doFetch: typeof fetch, url: string): Promise<string> {
    const res = await doFetch(url, {
      headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
    });
    if (isBlockStatus(res.status)) throw new PortalBlockedError(res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}
