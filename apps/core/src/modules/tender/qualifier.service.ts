import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGHA_PROFILE } from './company-profile';
import { qualify } from './qualifier.domain';
import { TENDER_REPOSITORY, type TenderRepository } from './tender.repository';

export interface QualifySummary {
  processed: number;
  qualified: number;
  rejected: number;
}

/** Qualifier (agent A3): eliminatory filter over freshly detected tenders. */
@Injectable()
export class QualifierService {
  private readonly logger = new Logger('Qualifier');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
  ) {}

  async runOnce(): Promise<QualifySummary> {
    // Lean candidate read — pipeline_state IN (detected,parsed) is filtered in SQL,
    // and qualify() reads only base columns, so this never detoasts the whole `raw`
    // catalogue into JS (the findAll() OOM class that crashed the 792 MB core when a
    // big ingest left the whole catalogue in 'detected').
    const candidates = await this.repository.findQualificationCandidates();

    let qualified = 0;
    let rejected = 0;

    for (const tender of candidates) {
      const result = qualify(tender, AGHA_PROFILE, new Date());
      // Avis-level fields are parsed: walk detected → parsed before verdict.
      if (tender.pipelineState === 'detected') {
        await this.repository.updateState(tender.id, 'parsed');
      }
      const nextState = result.verdict === 'qualified' ? 'qualified' : 'rejected';
      await this.repository.updateQualification(tender.id, nextState, result);

      if (result.verdict === 'qualified') {
        qualified += 1;
      } else {
        rejected += 1;
      }
      const failed = result.rules
        .filter((rule) => !rule.pass)
        .map((rule) => rule.rule);
      this.logger.log(
        `tender.${nextState} ${tender.reference}${failed.length > 0 ? ` (échecs: ${failed.join(', ')})` : ''}`,
      );
    }

    const summary = { processed: candidates.length, qualified, rejected };
    this.logger.log(`qualification terminée ${JSON.stringify(summary)}`);
    return summary;
  }
}
