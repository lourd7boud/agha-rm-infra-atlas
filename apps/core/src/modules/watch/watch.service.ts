import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DuplicateTenderError,
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { parsePmmpResults } from './watch.parser';
import { PORTAL_SOURCE, type PortalSource } from './watch.source';

export interface WatchRunSummary {
  fetched: number;
  inserted: number;
  duplicates: number;
  skippedRows: number;
  errors: number;
}

/** Sentinel (agent A1): fetch portal page → parse → ingest new tenders. */
@Injectable()
export class WatchService {
  private readonly logger = new Logger('Sentinel');

  constructor(
    @Inject(PORTAL_SOURCE) private readonly source: PortalSource,
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
  ) {}

  async runOnce(): Promise<WatchRunSummary> {
    const { html, sourceUrl } = await this.source.fetch();
    const { tenders, skippedRows } = parsePmmpResults(html, sourceUrl);

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
