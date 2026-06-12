import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  buildPricingScenarios,
  type PricingScenarios,
} from './pricing.domain';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from './tender.repository';

export interface PricingResult extends PricingScenarios {
  tenderId: string;
  reference: string;
  generatedAt: string;
}

/**
 * Financial Modeler (B4): grounds the pricing ladder in C1's competitor map
 * and persists the result under raw.g2Scenarios for the G2 price gate.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger('Pricing');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
  ) {}

  async generateScenarios(id: string): Promise<PricingResult> {
    const tender = await this.repository.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);
    if (tender.estimationMad === undefined || tender.estimationMad <= 0) {
      throw new UnprocessableEntityException(
        'Estimation administrative inconnue — enrichir le dossier (avis/DCE) avant le chiffrage',
      );
    }

    const competitorStats = await this.intel.listCompetitorStats();
    const scenarios = buildPricingScenarios({
      estimationMad: tender.estimationMad,
      competitorCount: competitorStats.length,
    });

    const result: PricingResult = {
      tenderId: tender.id,
      reference: tender.reference,
      generatedAt: new Date().toISOString(),
      ...scenarios,
    };
    await this.repository.updateEnrichment(id, {}, { g2Scenarios: result });

    this.logger.log(
      `gate.G2.scenarios ${tender.reference} → ${result.recommandation.nom} ` +
        `(${competitorStats.length} concurrents connus)`,
    );
    return result;
  }
}
