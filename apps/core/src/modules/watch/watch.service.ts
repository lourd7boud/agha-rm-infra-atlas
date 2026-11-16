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
import { SuiviCrawlerService } from './suivi.crawler';
import {
  SNAPSHOT_REPOSITORY,
  type SnapshotRepository,
} from './snapshot.repository';
import { parsePmmpResults } from './watch.parser';
import { pmmpIdentity, type WatchAuditCapture } from './watch-audit';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';
// Name-based so it matches whichever module's PortalBlockedError the listing
// walk throws (watch.source has its own). Result-stage crawlers report their
// own blocks via summary.stoppedEarly instead.
import { isPortalBlockedError } from './portal-fetch';
import { isPortalPausedError } from './portal-request-gate';
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
  status: 'complete' | 'partial' | 'failed' | 'blocked';
  stopReason: 'end' | 'page_limit' | 'repeated_page' | 'parser_mismatch' | 'fetch_failed' | 'blocked' | 'scheduled_closure';
  portalTotal?: number;
  uniqueSeen: number;
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
  /**
   * Injectable RNG for the inter-hop delay jitter (default Math.random).
   * Tests pass a deterministic function; production randomizes the cadence so a
   * long archive walk doesn't emit a fixed inter-request interval — the single
   * most common behavioural bot signal a WAF scores on.
   */
  random?: () => number;
}

/**
 * Randomize a base delay by ±40% (uniform in [0.6, 1.4]×) so consecutive hops
 * never share one cadence. `random() === 0.5` maps exactly to the base delay,
 * which keeps the politeness contract testable without asserting a range.
 */
function jitterDelay(baseMs: number, random: () => number): number {
  return Math.round(baseMs * (0.6 + random() * 0.8));
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
  private readonly random: () => number;

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
    @Inject(SuiviCrawlerService)
    private readonly suiviCrawler: SuiviCrawlerService | null = null,
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
    this.random = options?.random ?? Math.random;
  }

  async runOnce(options: {
    discoveryOnly?: boolean; progress?: (summary: WatchRunSummary) => Promise<void>;
    shouldPause?: () => Promise<boolean>; onBlocked?: () => Promise<void>;
    scheduledReopen?: () => Date | null;
    audit?: WatchAuditCapture;
  } = {}): Promise<WatchRunSummary> {
    const seenResults = new Set<string>();
    const seenTenders = new Set<string>();
    const declaredTotals = new Set<number>();
    let portalTotal: number | undefined;
    let stopReason: WatchRunSummary['stopReason'] = 'page_limit';
    let fetched = 0;
    let inserted = 0;
    let duplicates = 0;
    let healed = 0;
    let sourceUrlBackfilled = 0;
    let skippedRows = 0;
    let errors = 0;
    let pagesFetched = 0;
    let pagesUnchanged = 0;
    // Coordinated backoff: once ANY portal stage is blocked (429/403), skip the
    // remaining portal-hitting stages this sweep so we don't pile onto a live
    // block. Each stage sets this from its own block signal.
    let portalBlocked = false;

    for (let page = 1; page <= this.maxPages; page += 1) {
      if (options.scheduledReopen?.()) { stopReason = 'scheduled_closure'; break; }
      if (await options.shouldPause?.()) { portalBlocked = true; stopReason = 'blocked'; break; }
      let portalPage;
      try {
        portalPage = await this.source.fetch(page);
      } catch (error) {
        if (options.scheduledReopen?.()) { stopReason = 'scheduled_closure'; break; }
        // The source already retries with backoff; a final failure ends the
        // walk without discarding pages already ingested this run, and the
        // run still returns a summary (the BullMQ job is not rejected).
        const paused = isPortalPausedError(error);
        if (!paused) errors += 1;
        if (isPortalBlockedError(error) || paused) portalBlocked = true;
        if (portalBlocked && !paused) await options.onBlocked?.();
        stopReason = portalBlocked ? 'blocked' : 'fetch_failed';
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

      const parsed = parsePmmpResults(html, sourceUrl, Boolean(options.audit));
      const { tenders, skippedRows: pageSkipped } = parsed;
      if (options.audit) {
        options.audit.record({
          page, declared: parsed.portalTotal ?? null,
          sourceRows: parsed.sourceIdentities ?? (parsed.portalTotal === 0 && pageSkipped === 0 ? [] : null),
          parsed: tenders.flatMap((tender) => {
            const identity = tender.sourceUrl ? pmmpIdentity(tender.sourceUrl) : null;
            return identity ? [identity] : [];
          }),
          skippedRows: pageSkipped,
        });
      }
      if (parsed.portalTotal !== undefined) {
        declaredTotals.add(parsed.portalTotal);
        portalTotal = Math.max(portalTotal ?? 0, parsed.portalTotal);
      }

      // No parseable rows. Past the first page this is the clean end of the
      // result set — stop without recording a coverage miss. On the first
      // page it is a parser/portal miss worth recording, then stop.
      if (tenders.length === 0) {
        // Only our explicit end marker or a recognized zero-count search is empty.
        const cleanEnd = portalPage.endOfResults === true ||
          (portalTotal === 0 && pageSkipped === 0);
        stopReason = cleanEnd ? 'end' : 'parser_mismatch';
        if (!cleanEnd) errors += 1;
        if (page > 1) skippedRows += pageSkipped;
        if (page === 1) {
          pagesFetched += 1;
          if (!decision.changed) pagesUnchanged += 1;
          skippedRows += pageSkipped;
          if (this.snapshots) {
            await this.snapshots.record({
              source: 'watch',
              url: sourceUrl,
              ...decision,
              parsedOk: cleanEnd,
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
      const keys = tenders.map((t) => t.sourceUrl ?? `${t.reference}\u0000${t.buyerName}`);
      const fingerprint = resultFingerprint(keys);
      if (seenResults.has(fingerprint)) { stopReason = 'repeated_page'; break; }
      seenResults.add(fingerprint);
      keys.forEach((key) => seenTenders.add(key));

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
              estimationMad: tender.estimationMad,
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
          await this.tenders.create(tender, 'portal');
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

      if (options.progress) await options.progress({
        status: 'partial', stopReason: 'page_limit', portalTotal, uniqueSeen: seenTenders.size,
        fetched, inserted, duplicates, healed, sourceUrlBackfilled, skippedRows, errors, pagesFetched,
      });
      if (portalPage.hasNext === false) { stopReason = 'end'; break; }
      if (this.delayMs > 0 && page < this.maxPages) {
        await this.sleep(jitterDelay(this.delayMs, this.random));
      }
    }

    const summary: WatchRunSummary = {
      status: stopReason === 'scheduled_closure' ? 'partial'
        : portalBlocked ? 'blocked' : (errors === 0 && skippedRows === 0 && stopReason === 'end' &&
        fetched === seenTenders.size && declaredTotals.size <= 1 &&
        (portalTotal === undefined || seenTenders.size === portalTotal))
        ? 'complete' : seenTenders.size > 0 ? 'partial' : 'failed',
      stopReason, portalTotal, uniqueSeen: seenTenders.size,
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
    if (options.progress) await options.progress(summary);
    if (!options.discoveryOnly && !portalBlocked && stopReason !== 'scheduled_closure' && errors === 0) await this.enrichOnce();
    return summary;
  }

  /** Separate queue: slow dossier/AI work never delays the next discovery run. */
  async enrichOnce(control: { shouldPause?: () => Promise<boolean>; onBlocked?: () => Promise<void> } = {}): Promise<{ blocked: boolean }> {
    let portalBlocked = false;
    const allowed = async () => {
      if (await control.shouldPause?.()) portalBlocked = true;
      return !portalBlocked;
    };
    // Stage-2: auto-enrich the freshest consultations from their detail pages
    // (caution, category, detail URL). A failure here never fails the Sentinel.
    if (this.detailCrawler && await allowed()) {
      // DB targets span all discovered pages; never reset the discovery source's
      // stateful PRADO session or load the whole catalogue to match by reference.
      // Refresh missing/outdated metadata, prioritizing active consultations.
      // A portal omission stays unknown; failed pages are never stamped complete.
      try {
        const maxDetails = envLimit('WATCH_DETAIL_BACKFILL', 40);
        if (maxDetails > 0 && await allowed()) {
          const backfill = await this.detailCrawler.backfillMissing({ maxDetails, ...control });
          this.logger.log(`detail backfill ${JSON.stringify(backfill)}`);
          if (backfill.stoppedEarly) {
            portalBlocked = true;
            if (!backfill.paused) await control.onBlocked?.();
            this.logger.warn('detail backfill hit a portal block — backing off the rest of this sweep');
          }
        }
      } catch (error) {
        this.logger.error(`detail backfill failed: ${(error as Error).message}`);
      }
    }
    // Stage-3: harvest a few published results (vision-read scanned notices →
    // competitor wins). Bounded to cap vision cost; failures never fail the run.
    if (this.resultCrawler && await allowed()) {
      try {
        // Was hard-coded 3 — way too low to ever reach datao's ~45k catalogue
        // of attribution notices. Env-tunable; default 25/sweep ≈ 600/day at
        // hourly Sentinel, still polite + bounded by the vision LLM cost.
        const maxResults = envLimit('WATCH_RESULT_LIMIT', DEFAULT_RESULT_LIMIT);
        const maxPages = envLimit('WATCH_RESULT_MAX_PAGES', 5);
        if (maxResults > 0) {
          const results = await this.resultCrawler.crawlOnce({ maxResults, maxPages });
          this.logger.log(`result harvest ${JSON.stringify(results)}`);
          if (results.stoppedEarly) {
            portalBlocked = true;
            await control.onBlocked?.();
            this.logger.warn('result harvest hit a portal block — backing off the rest of this sweep');
          }
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
    if (this.pvCrawler && await allowed()) {
      try {
        const maxPv = envLimit('WATCH_PV_LIMIT', DEFAULT_PV_LIMIT);
        const maxPages = envLimit('WATCH_PV_MAX_PAGES', 3);
        if (maxPv > 0) {
          const pv = await this.pvCrawler.crawlOnce({ maxPv, maxPages });
          this.logger.log(`pv harvest ${JSON.stringify(pv)}`);
          if (pv.stoppedEarly) {
            portalBlocked = true;
            await control.onBlocked?.();
            this.logger.warn('pv harvest hit a portal block — backing off the rest of this sweep');
          }
        }
      } catch (error) {
        this.logger.error(`pv harvest failed: ${(error as Error).message}`);
      }
    }
    // Stage-3c: harvest "Suivre la commission" (SuiviConsultation) — the WHOLE
    // structured bidder field + amounts for past-deadline consultations, zero OCR
    // (the datao "Résultats"/concurrents source). Bounded via WATCH_SUIVI_LIMIT;
    // failures never fail the Sentinel.
    if (this.suiviCrawler && await allowed()) {
      try {
        const maxSuivi = envLimit('WATCH_SUIVI_LIMIT', 0);
        if (maxSuivi > 0) {
          const suivi = await this.suiviCrawler.crawlBacklog({ maxSuivi });
          this.logger.log(`suivi harvest ${JSON.stringify(suivi)}`);
          if (suivi.stoppedEarly) {
            portalBlocked = true;
            await control.onBlocked?.();
            this.logger.warn('suivi harvest hit a portal block — backing off the rest of this sweep');
          }
        }
      } catch (error) {
        this.logger.error(`suivi harvest failed: ${(error as Error).message}`);
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
    if (this.dossierExtraction && await allowed()) {
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
    return { blocked: portalBlocked };
  }
}
