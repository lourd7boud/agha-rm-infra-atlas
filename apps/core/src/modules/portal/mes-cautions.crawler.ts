import { Inject, Injectable, Logger } from '@nestjs/common';
import { PortalAuthSession } from './portal-auth';
import {
  PORTAL_REPOSITORY,
  type PortalCautionInput,
  type PortalRepository,
} from './portal.repository';
import { parseMesCautionsDetailed } from './mes-cautions.parser';

/**
 * Authenticated-account harvest — "Mes cautions" (page=entreprise.MesCautions).
 *
 * One READ-ONLY GET of our own guarantees listing, parsed into PortalCautionInput
 * rows, each upserted (back-fill semantics live in the repository). Mirrors the
 * fetch → parse → upsert → summary shape of ../watch/result.crawler.ts, minus the
 * vision/detail walk (this page is a single self-contained listing). Resilient:
 * the parser already skips+collects malformed rows, and each upsert is wrapped so
 * one bad row is counted as an error and never crashes the run.
 */

const DEFAULT_MES_CAUTIONS_URL =
  'https://www.marchespublics.gov.ma/index.php?page=entreprise.MesCautions';

/** Outcome of one harvest, mirroring the result.crawler summary idiom. */
export interface MesCautionsCrawlSummary {
  /** Cautions the parser yielded from the listing (post-skip). */
  fetched: number;
  inserted: number;
  updated: number;
  /** Rows the parser dropped (malformed) plus upserts that threw. */
  skipped: number;
}

export interface MesCautionsCrawlDeps {
  /** Authenticated, READ-ONLY GET of the MesCautions listing → its HTML. */
  fetchListing: () => Promise<string>;
  upsertCaution: (input: PortalCautionInput) => Promise<'inserted' | 'updated'>;
}

/**
 * Pure orchestrator (no Nest, no HTTP, no DB): fetch the listing, parse it, and
 * upsert each caution, tallying inserted/updated and counting any row that fails
 * to store as skipped. Deps are injected so this is unit-testable with a fake
 * authedFetch (fixture HTML) and an InMemoryPortalRepository.
 */
export async function crawlMesCautions(
  deps: MesCautionsCrawlDeps,
): Promise<MesCautionsCrawlSummary> {
  const html = await deps.fetchListing();
  const { cautions, skipped } = parseMesCautionsDetailed(html);

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const caution of cautions) {
    try {
      const action = await deps.upsertCaution(caution);
      if (action === 'inserted') inserted += 1;
      else updated += 1;
    } catch {
      // A single bad upsert (e.g. transient DB error) must not abort the harvest.
      failed += 1;
    }
  }

  return {
    fetched: cautions.length,
    inserted,
    updated,
    skipped: skipped.length + failed,
  };
}

/**
 * Wires the harvest to the live portal session (one polite authenticated GET) and
 * the portal repository (idempotent upserts). The session handles login + cookie
 * reuse + re-login on expiry; this service stays thin.
 */
@Injectable()
export class MesCautionsCrawlerService {
  private readonly logger = new Logger('MesCautionsCrawler');

  constructor(
    // The session provider yields null when portal credentials are absent (see
    // portalSessionProvider in portal.module.ts), so this is nullable. @Inject is
    // explicit for symmetry with MesReponsesCrawlerService — both bind to the
    // PortalAuthSession token rather than relying on type-token inference.
    @Inject(PortalAuthSession)
    private readonly session: PortalAuthSession | null,
    @Inject(PORTAL_REPOSITORY) private readonly repository: PortalRepository,
  ) {}

  async harvest(): Promise<MesCautionsCrawlSummary> {
    // Defend at the harvest boundary, not just via the module's external guard:
    // a direct call (future controller endpoint, test) must fail loudly with a
    // clear message rather than crash on `null.authedFetch`.
    if (!this.session) {
      throw new Error(
        'MesCautions harvest requires portal credentials (PORTAL_AUTH_LOGIN/PORTAL_AUTH_PASSWORD)',
      );
    }
    const session = this.session;
    const url = process.env.MES_CAUTIONS_URL ?? DEFAULT_MES_CAUTIONS_URL;
    const summary = await crawlMesCautions({
      fetchListing: () => session.authedFetch(url),
      upsertCaution: (input) => this.repository.upsertCaution(input),
    });
    this.logger.log(`mes-cautions harvest complete ${JSON.stringify(summary)}`);
    return summary;
  }
}
