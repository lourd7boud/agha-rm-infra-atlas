import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DuplicateTenderError,
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { decideSnapshot } from './snapshot.domain';
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
  /** Content fingerprint unchanged since last crawl — parse skipped. */
  unchanged?: boolean;
}

/** Sentinel (agent A1): fetch portal page → parse → ingest new tenders. */
@Injectable()
export class WatchService {
  private readonly logger = new Logger('Sentinel');

  constructor(
    @Inject(PORTAL_SOURCE) private readonly source: PortalSource,
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Optional()
    @Inject(SNAPSHOT_REPOSITORY)
    private readonly snapshots: SnapshotRepository | null = null,
  ) {}

  async runOnce(): Promise<WatchRunSummary> {
    const { html, sourceUrl } = await this.source.fetch();

    // Coverage pipeline: fingerprint every fetch, skip parsing when the
    // portal content is byte-identical to the previous crawl.
    const previousSha = this.snapshots
      ? await this.snapshots.lastSha('watch', sourceUrl)
      : null;
    const decision = decideSnapshot(html, previousSha);
    if (this.snapshots && !decision.changed) {
      await this.snapshots.record({
        source: 'watch',
        url: sourceUrl,
        ...decision,
        parsedOk: true,
        items: 0,
      });
      this.logger.log('portal unchanged — parse skipped');
      return {
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        skippedRows: 0,
        errors: 0,
        unchanged: true,
      };
    }

    const { tenders, skippedRows } = parsePmmpResults(html, sourceUrl);
    if (this.snapshots) {
      await this.snapshots.record({
        source: 'watch',
        url: sourceUrl,
        ...decision,
        parsedOk: tenders.length > 0,
        items: tenders.length,
      });
    }

    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    for (const tender of tenders) {
      try {
        await this.tenders.create(tender);
        inserted += 1;
        this.logger.log(`tender.detected ${tender.reference} (${tender.buyerName})`);
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

    const summary: WatchRunSummary = {
      fetched: tenders.length,
      inserted,
      duplicates,
      skippedRows,
      errors,
    };
    this.logger.log(`run complete ${JSON.stringify(summary)}`);
    return summary;
  }
}
