import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DuplicateTenderError,
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { decideSnapshot } from './snapshot.domain';
import { DetailCrawlerService } from './detail.crawler';
import {
  SNAPSHOT_REPOSITORY,
  type SnapshotRepository,
} from './snapshot.repository';
import { parsePmmpResults } from './watch.parser';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';

export interface WatchRunSummary {
  fetched: number;
  inserted: number;
  duplicates: number;
  skippedRows: number;
  errors: number;
  /** Pages actually fetched and parsed this run. */
  pagesFetched: number;
  /** Every fetched page was byte-identical to the previous crawl. */
  unchanged?: boolean;
}

export interface WatchRunOptions {
  /** Hard cap on pages walked per run (politeness + runaway guard). */
  maxPages?: number;
  /** Delay between page fetches in ms (politeness toward the portal). */
  delayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const WATCH_OPTIONS = Symbol('WATCH_OPTIONS');

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Stable fingerprint of a page's parsed result set (order-independent). */
function resultFingerprint(references: readonly string[]): string {
  return [...references].sort().join('');
}

/**
 * Sentinel (agent A1): walk the portal's paginated result set → parse each
 * page → ingest new tenders. The crawl stops when a page repeats the parsed
 * result set already seen this run (the source ran past the last page, or is
 * single-page / ignored the page index), when a page beyond the first yields
 * no rows, on a fetch failure, or at the maxPages cap. DB-level dedup makes
 * re-crawling idempotent.
 */
@Injectable()
export class WatchService {
  private readonly logger = new Logger('Sentinel');
  private readonly maxPages: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    @Inject(PORTAL_SOURCE) private readonly source: PortalSource,
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Optional()
    @Inject(SNAPSHOT_REPOSITORY)
    private readonly snapshots: SnapshotRepository | null = null,
    @Optional()
    @Inject(WATCH_OPTIONS)
    options: WatchRunOptions | null = null,
    @Optional()
    @Inject(DetailCrawlerService)
    private readonly detailCrawler: DetailCrawlerService | null = null,
  ) {
    // Defensive finite guards: a poisoned env (NaN) must not silently disable
    // the crawl (page <= NaN is false → zero fetches) or the politeness delay.
    const mp = options?.maxPages;
    this.maxPages = Number.isFinite(mp) && (mp as number) >= 1 ? Math.floor(mp as number) : 1;
    const dm = options?.delayMs;
    this.delayMs = Number.isFinite(dm) && (dm as number) >= 0 ? Math.floor(dm as number) : 0;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  async runOnce(): Promise<WatchRunSummary> {
    const seenResults = new Set<string>();
    let fetched = 0;
    let inserted = 0;
    let duplicates = 0;
    let skippedRows = 0;
    let errors = 0;
    let pagesFetched = 0;
    let pagesUnchanged = 0;

    for (let page = 1; page <= this.maxPages; page += 1) {
      let portalPage;
      try {
        portalPage = await this.source.fetch(page);
      } catch (error) {
        // The source already retries with backoff; a final failure ends the
        // walk without discarding pages already ingested this run, and the
        // run still returns a summary (the BullMQ job is not rejected).
        errors += 1;
        this.logger.error(
          `Portal fetch failed on page ${page}: ${(error as Error).message}`,
        );
        break;
      }
      const { html, sourceUrl } = portalPage;
      const previousSha = this.snapshots
        ? await this.snapshots.lastSha('watch', sourceUrl)
        : null;
      const decision = decideSnapshot(html, previousSha);

      const { tenders, skippedRows: pageSkipped } = parsePmmpResults(
        html,
        sourceUrl,
      );

      // No parseable rows. Past the first page this is the clean end of the
      // result set — stop without recording a coverage miss. On the first
      // page it is a parser/portal miss worth recording, then stop.
      if (tenders.length === 0) {
        if (page === 1) {
          pagesFetched += 1;
          if (!decision.changed) pagesUnchanged += 1;
          skippedRows += pageSkipped;
          if (this.snapshots) {
            await this.snapshots.record({
              source: 'watch',
              url: sourceUrl,
              ...decision,
              parsedOk: false,
              items: 0,
            });
          }
        }
        break;
      }

      // Within-run loop-stop keyed on the parsed result set (immune to
      // volatile page chrome / per-request nonces): a page repeating an
      // earlier page's tenders means the source ran past the last page or
      // ignored the page index.
      const fingerprint = resultFingerprint(tenders.map((t) => t.reference));
      if (seenResults.has(fingerprint)) break;
      seenResults.add(fingerprint);

      pagesFetched += 1;
      if (!decision.changed) pagesUnchanged += 1;
      skippedRows += pageSkipped;
      if (this.snapshots) {
        await this.snapshots.record({
          source: 'watch',
          url: sourceUrl,
          ...decision,
          parsedOk: true,
          items: tenders.length,
        });
      }

      fetched += tenders.length;
      for (const tender of tenders) {
        try {
          await this.tenders.create(tender);
          inserted += 1;
          this.logger.log(
            `tender.detected ${tender.reference} (${tender.buyerName})`,
          );
        } catch (error) {
          if (error instanceof DuplicateTenderError) {
            duplicates += 1;
            continue;
          }
          errors += 1;
          this.logger.error(
            `Ingest failed for ${tender.reference}: ${(error as Error).message}`,
          );
        }
      }

      if (this.delayMs > 0 && page < this.maxPages) {
        await this.sleep(this.delayMs);
      }
    }

    const summary: WatchRunSummary = {
      fetched,
      inserted,
      duplicates,
      skippedRows,
      errors,
      pagesFetched,
      ...(pagesFetched > 0 && pagesUnchanged === pagesFetched
        ? { unchanged: true }
        : {}),
    };
    this.logger.log(`run complete ${JSON.stringify(summary)}`);
    // Stage-2: auto-enrich the freshest consultations from their detail pages
    // (caution, category, detail URL). A failure here never fails the Sentinel.
    if (this.detailCrawler) {
      try {
        const detail = await this.detailCrawler.crawlOnce({ maxDetails: 20 });
        this.logger.log(`detail enrichment ${JSON.stringify(detail)}`);
      } catch (error) {
        this.logger.error(
          `detail enrichment failed: ${(error as Error).message}`,
        );
      }
    }
    return summary;
  }
}
