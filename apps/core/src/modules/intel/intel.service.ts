import { Inject, Injectable, Logger } from '@nestjs/common';
import { PORTAL_SOURCE, type PortalSource } from '../watch/watch.source';
import { parseResultsPage } from './intel.parser';
import { INTEL_REPOSITORY, type IntelRepository } from './intel.repository';

export interface HarvestSummary {
  fetched: number;
  inserted: number;
  duplicates: number;
  skippedRows: number;
}

/** Result Miner (agent C1): harvest published results into the intel base. */
@Injectable()
export class IntelService {
  private readonly logger = new Logger('ResultMiner');

  constructor(
    @Inject(PORTAL_SOURCE) private readonly source: PortalSource,
    @Inject(INTEL_REPOSITORY) private readonly repository: IntelRepository,
  ) {}

  async harvestOnce(): Promise<HarvestSummary> {
    const { html, sourceUrl } = await this.source.fetch();
    const { results, skippedRows } = parseResultsPage(html, sourceUrl);

    let inserted = 0;
    let duplicates = 0;

    for (const result of results) {
      const competitor = await this.repository.upsertCompetitor(result.bidderName);
      const isNew = await this.repository.insertResult(result, competitor.id);
      if (isNew) {
        inserted += 1;
        this.logger.log(
          `intel.result ${result.reference} → ${competitor.canonicalName}` +
            (result.amountMad
              ? ` (${result.amountMad.toLocaleString('fr-MA')} MAD)`
              : ''),
        );
      } else {
        duplicates += 1;
      }
    }

    const summary = { fetched: results.length, inserted, duplicates, skippedRows };
    this.logger.log(`harvest terminé ${JSON.stringify(summary)}`);
    return summary;
  }
}
