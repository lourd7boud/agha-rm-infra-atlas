import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DuplicateTenderError,
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { decideSnapshot } from './snapshot.domain';
import { DetailCrawlerService } from './detail.crawler';
import { ResultCrawlerService } from './result.crawler';
import { ExtraitPvCrawlerService } from './pv.crawler';
import {
  SNAPSHOT_REPOSITORY,
  type SnapshotRepository,
} from './snapshot.repository';
import { parsePmmpResults } from './watch.parser';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';
import { EnrichmentService } from '../tender/enrichment.service';
import { DossierExtractionService } from '../tender/dossier-extraction.service';
import { ExpertService } from '../expert/expert.service';

/** Per-run caps for the post-crawl auto-analysis (bounded cost + memory). */
const DEFAULT_ENRICH_LIMIT = 80;
const DEFAULT_EXTRACT_LIMIT = 40;
/** Per-run cap on Résultats notices read with the vision LLM (slow + paid). */
const DEFAULT_RESULT_LIMIT = 25;
/**
 * Per-run cap on extraits de PV read per sweep (each = one OCR + LLM call).
 * Opt-in: 0 keeps the stage dormant until WATCH_PV_LIMIT is set — the PV
 * harvest shares the same daily LLM budget as enrichment + extraction.
 */
const DEFAULT_PV_LIMIT = 0;
function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export interface WatchRunSummary {
  fetched: number;
  inserted: number;
  duplicates: number;
  /**
   * Existing rows refreshed in place via the stable canonical sourceUrl —
   * the migration path that rewrites legacy messy reference/buyer-as-location
   * rows to clean values without inserting a duplicate.
   */
  healed: number;
  /** Legacy rows whose NULL source_url was healed from the canonical detail link. */
  sourceUrlBackfilled: number;
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
    @Optional()
    @Inject(ResultCrawlerService)
    private readonly resultCrawler: ResultCrawlerService | null = null,
    @Optional()
    @Inject(ExtraitPvCrawlerService)
    private readonly pvCrawler: ExtraitPvCrawlerService | null = null,
    @Optional()
    @Inject(EnrichmentService)
    private readonly enrichment: EnrichmentService | null = null,
    @Optional()
    @Inject(DossierExtractionService)
    private readonly dossierExtraction: DossierExtractionService | null = null,
    @Optional()
    @Inject(ExpertService)
    private readonly expert: ExpertService | null = null,
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
    let healed = 0;
    let sourceUrlBackfilled = 0;
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
        // Source_url-first heal: an existing row matched on the STABLE canonical
        // URL is refreshed in place. This rewrites legacy messy rows (reference
        // glued to the objet, buyerName holding the lieu d'exécution) AND avoids
        // the duplicate that create()'s reference+buyer match would insert now
        // that the parser emits clean, different values for the same row.
        if (tender.sourceUrl) {
          let didHeal = false;
          try {
            didHeal = await this.tenders.healListingBySourceUrl(tender.sourceUrl, {
              reference: tender.reference,
              buyerName: tender.buyerName,
              procedure: tender.procedure,
              objet: tender.objet,
              location: tender.location,
              deadlineAt: tender.deadlineAt,
            });
          } catch (healError) {
            // A row with this source_url likely already exists; falling through
            // to create() could insert a duplicate (the clean reference won't
            // match the legacy reference+buyer dedup key). Skip and let the next
            // run retry the heal cleanly.
            errors += 1;
            this.logger.warn(
              `heal failed for ${tender.reference}: ${(healError as Error).message}`,
            );
            continue;
          }
          if (didHeal) {
            healed += 1;
            continue;
          }
        }
        try {
          await this.tenders.create(tender);
          inserted += 1;
          this.logger.log(
            `tender.detected ${tender.reference} (${tender.buyerName})`,
          );
        } catch (error) {
          if (error instanceof DuplicateTenderError) {
            duplicates += 1;
            // No row matched the canonical sourceUrl but reference+buyer
            // collided — a source that carries no canonical URL. Backfill the
            // source_url when we have one. A failure must not fail the run.
            if (tender.sourceUrl) {
              try {
                const filled = await this.tenders.backfillSourceUrl(
                  tender.reference,
                  tender.buyerName,
                  tender.sourceUrl,
                );
                if (filled) sourceUrlBackfilled += 1;
              } catch (backfillError) {
                this.logger.warn(
                  `sourceUrl backfill failed for ${tender.reference}: ${(backfillError as Error).message}`,
                );
              }
            }
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
      healed,
      sourceUrlBackfilled,
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
      // Stage-2b: DB-driven caution backfill — targets OUR rows still missing
      // the caution through their stored detail URL (newest first, zero LLM).
      // The listing crawl above only ever sees page 1; this stage is what
      // actually guarantees "no tender stays without its caution".
      try {
        const maxDetails = envLimit('WATCH_DETAIL_BACKFILL', 40);
        if (maxDetails > 0) {
          const backfill = await this.detailCrawler.backfillMissing({ maxDetails });
          this.logger.log(`detail backfill ${JSON.stringify(backfill)}`);
        }
      } catch (error) {
        this.logger.error(`detail backfill failed: ${(error as Error).message}`);
      }
    }
    // Stage-3: harvest a few published results (vision-read scanned notices →
    // competitor wins). Bounded to cap vision cost; failures never fail the run.
    if (this.resultCrawler) {
      try {
        // Was hard-coded 3 — way too low to ever reach datao's ~45k catalogue
        // of attribution notices. Env-tunable; default 25/sweep ≈ 600/day at
        // hourly Sentinel, still polite + bounded by the vision LLM cost.
        const maxResults = envLimit('WATCH_RESULT_LIMIT', DEFAULT_RESULT_LIMIT);
        const maxPages = envLimit('WATCH_RESULT_MAX_PAGES', 5);
        if (maxResults > 0) {
          const results = await this.resultCrawler.crawlOnce({ maxResults, maxPages });
          this.logger.log(`result harvest ${JSON.stringify(results)}`);
        }
      } catch (error) {
        this.logger.error(`result harvest failed: ${(error as Error).message}`);
      }
    }
    // Stage-3b: harvest extraits de PV (annonceType=5) — the ONLY source that
    // publishes the FULL bidder field (winner + écartés) plus the administrative
    // estimation. This is what teaches the expert agent how many competitors
    // show up per buyer and what rebates actually win. Opt-in via WATCH_PV_LIMIT;
    // failures never fail the run.
    if (this.pvCrawler) {
      try {
        const maxPv = envLimit('WATCH_PV_LIMIT', DEFAULT_PV_LIMIT);
        const maxPages = envLimit('WATCH_PV_MAX_PAGES', 3);
        if (maxPv > 0) {
          const pv = await this.pvCrawler.crawlOnce({ maxPv, maxPages });
          this.logger.log(`pv harvest ${JSON.stringify(pv)}`);
        }
      } catch (error) {
        this.logger.error(`pv harvest failed: ${(error as Error).message}`);
      }
    }
    // Stage-4: AI-enrich a bounded batch of newly-detected (still-unenriched)
    // tenders — secteur/résumé/FAQ/lots. Bounded for cost; failures never fail
    // the Sentinel. This is what makes new consultations self-analyse each run.
    if (this.enrichment) {
      try {
        const limit = envLimit('WATCH_ENRICH_LIMIT', DEFAULT_ENRICH_LIMIT);
        if (limit > 0) {
          const r = await this.enrichment.aiEnrichBatch(limit, { onlyActive: true });
          this.logger.log(`auto-enrich ${JSON.stringify(r)}`);
        }
      } catch (error) {
        this.logger.error(`auto-enrich failed: ${(error as Error).message}`);
      }
    }
    // Stage-5: extract the real DCE data (budget/caution/qualifications/BPU) for
    // a bounded batch of still-unextracted tenders. Bounded for portal load +
    // memory (PDF parsing); failures never fail the Sentinel.
    if (this.dossierExtraction) {
      try {
        const limit = envLimit('WATCH_EXTRACT_LIMIT', DEFAULT_EXTRACT_LIMIT);
        if (limit > 0) {
          const r = await this.dossierExtraction.extractBatch(limit, { onlyActive: true });
          this.logger.log(`auto-extract ${JSON.stringify(r)}`);
        }
      } catch (error) {
        this.logger.error(`auto-extract failed: ${(error as Error).message}`);
      }
    }
    // Stage-6: refresh the expert agent's knowledge snapshot in the worker so
    // the API always serves a precomputed read (constant latency for users).
    // Every sweep just added data — this is the moment the agent "re-learns".
    if (this.expert) {
      try {
        await this.expert.refreshKnowledge();
        this.logger.log('expert knowledge snapshot refreshed');
      } catch (error) {
        this.logger.error(
          `knowledge refresh failed: ${(error as Error).message}`,
        );
      }
    }
    return summary;
  }
}
