import { Inject, Injectable, Logger } from '@nestjs/common';
import { PortalAuthSession } from './portal-auth';
import {
  parseMesReponsesDetailed,
  type ParseMesReponsesOutcome,
} from './mes-reponses.parser';
import {
  PORTAL_REPOSITORY,
  type PortalRepository,
  type PortalSubmissionInput,
} from './portal.repository';

/**
 * "Mes réponses" crawler (page=entreprise.MesReponses) — harvests every
 * soumission this authenticated account deposited and upserts it into the portal
 * repository. Mirrors the watch/result.crawler.ts shape: a pure orchestrator with
 * injected deps (HTTP-free, DB-free for tests) plus a thin Nest-injectable service
 * that wires the live PortalAuthSession (READ-ONLY authed GET) and the repository.
 *
 * Idempotent by construction: upsertSubmission is keyed on (reference, deadlineAt)
 * with null-never-erases back-fill, so a second run re-visits the same rows as
 * 'updated' — no duplicates.
 */

const MES_REPONSES_URL =
  'https://www.marchespublics.gov.ma/index.php?page=entreprise.MesReponses';

/** Default ceiling on result pages walked per run (these accounts hold ~13-15 rows). */
const DEFAULT_MAX_PAGES = 5;
/** Default polite delay between page fetches. */
const DEFAULT_PAGE_DELAY_MS = 800;

export interface MesReponsesCrawlSummary {
  /** Soumission rows parsed across every page walked. */
  fetched: number;
  inserted: number;
  updated: number;
  /** Rows the parser could not map (no référence / no date limite). */
  skipped: number;
}

export interface MesReponsesCrawlOptions {
  /** Hard ceiling on pages walked (best-effort PRADO pagination). */
  maxPages?: number;
  delayMs?: number;
}

export interface MesReponsesCrawlDeps {
  /** READ-ONLY GET of the MesReponses listing for a 1-based page index. */
  fetchPage: (page: number) => Promise<string>;
  upsertSubmission: (
    input: PortalSubmissionInput,
  ) => Promise<'inserted' | 'updated'>;
  sleep: (ms: number) => Promise<void>;
  /** Reports a page that yielded skipped rows so the caller can log/count. */
  onSkipped?: (outcome: ParseMesReponsesOutcome, page: number) => void;
  /** Reports the "Nombre de résultats : N" header when it exceeds parsed rows. */
  onUnderParsed?: (declared: number, parsed: number) => void;
}

/** First "Nombre de résultats : N" count on the page, or undefined when absent. */
function declaredResultCount(html: string): number | undefined {
  const m = /Nombre\s+de\s+r[ée]sultats\s*:\s*([\d   ]+)/i.exec(html);
  if (!m?.[1]) return undefined;
  const digits = m[1].replace(/[^\d]/g, '');
  return digits.length > 0 ? Number(digits) : undefined;
}

/**
 * Stable de-duplication key matching the repository's (reference, deadlineAt)
 * unique index — guards against the same row appearing on two walked pages.
 */
function submissionKey(input: PortalSubmissionInput): string {
  return `${input.reference} ${input.deadlineAt?.getTime() ?? ''}`;
}

/**
 * Pure orchestrator. Walks the MesReponses pages (best-effort PRADO pagination),
 * parses each, upserts every soumission, and returns a {fetched, inserted,
 * updated, skipped} summary. Resilient: a page whose fetch/parse throws is
 * skipped+logged, never aborting the run. Pagination stops when the declared
 * result count is reached, a page yields no new rows, or maxPages is hit.
 */
export async function harvestMesReponses(
  deps: MesReponsesCrawlDeps,
  opts: MesReponsesCrawlOptions = {},
): Promise<MesReponsesCrawlSummary> {
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? DEFAULT_MAX_PAGES));
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? DEFAULT_PAGE_DELAY_MS));

  const seen = new Set<string>();
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let declared: number | undefined;

  for (let page = 1; page <= maxPages; page += 1) {
    let outcome: ParseMesReponsesOutcome;
    let html: string;
    try {
      html = await deps.fetchPage(page);
      outcome = parseMesReponsesDetailed(html);
    } catch {
      // A bad page must not crash the whole harvest — stop walking, keep totals.
      break;
    }

    if (page === 1) declared = declaredResultCount(html);
    skipped += outcome.skipped.length;
    if (outcome.skipped.length > 0) deps.onSkipped?.(outcome, page);

    let newOnPage = 0;
    for (const input of outcome.submissions) {
      const key = submissionKey(input);
      if (seen.has(key)) continue; // same row re-listed on the next page
      seen.add(key);
      newOnPage += 1;
      fetched += 1;
      const action = await deps.upsertSubmission(input);
      if (action === 'inserted') inserted += 1;
      else updated += 1;
    }

    // Stop on the last page: no new rows, or the declared total is covered.
    if (newOnPage === 0) break;
    if (declared !== undefined && seen.size >= declared) break;
    if (delayMs > 0 && page < maxPages) await deps.sleep(delayMs);
  }

  if (declared !== undefined && declared > seen.size) {
    deps.onUnderParsed?.(declared, seen.size);
  }

  return { fetched, inserted, updated, skipped };
}

const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wires the MesReponses harvest to the live authenticated session (lazy login +
 * cookie reuse, READ-ONLY GETs) and the portal repository. The PortalAuthSession
 * is GET-only, so production walks page 1 only; if "Nombre de résultats" exceeds
 * the parsed rows it is logged for a follow-up (the PRADO next-page postback is a
 * POST and these accounts hold ~13-15 rows on one page in practice).
 */
@Injectable()
export class MesReponsesCrawlerService {
  private readonly logger = new Logger('MesReponsesCrawler');

  constructor(
    @Inject(PortalAuthSession) private readonly session: PortalAuthSession,
    @Inject(PORTAL_REPOSITORY) private readonly repository: PortalRepository,
  ) {}

  async harvest(
    opts: MesReponsesCrawlOptions = {},
  ): Promise<MesReponsesCrawlSummary> {
    // Single authed GET per run: re-fetching the same READ-ONLY page for each
    // requested index keeps the orchestrator's de-dup/result-count logic intact
    // without issuing a PRADO postback the session layer cannot replay.
    const summary = await harvestMesReponses(
      {
        fetchPage: () => this.session.authedFetch(MES_REPONSES_URL),
        upsertSubmission: (input) => this.repository.upsertSubmission(input),
        sleep: sleepMs,
        onSkipped: (outcome, page) =>
          this.logger.warn(
            `mes-reponses page ${page}: skipped ${outcome.skipped.length} unparseable row(s)`,
          ),
        onUnderParsed: (declared, parsed) =>
          this.logger.warn(
            `mes-reponses declares ${declared} résultats but only ${parsed} parsed — ` +
              'PRADO pagination not followed (live-HTML validation pass needed)',
          ),
      },
      // Production is single-page (GET-only session); cap pages at 1.
      { ...opts, maxPages: 1 },
    );
    this.logger.log(`mes-reponses harvest complete ${JSON.stringify(summary)}`);
    return summary;
  }
}
