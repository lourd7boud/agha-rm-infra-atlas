import { describe, expect, it } from 'vitest';
import { InMemoryIntelRepository } from '../intel/intel.repository';
import type { RebateBenchmarks } from '../intel/rebate.domain';
import { PricingService } from './pricing.service';
import {
  InMemoryTenderRepository,
  type CreateTender,
} from './tender.repository';

const TENDER: CreateTender = {
  reference: 'AO 7/2026',
  buyerName: 'ORMVAH',
  procedure: 'AOO',
  objet: "travaux d'irrigation goutte a goutte",
  estimationMad: 10_000_000,
  deadlineAt: new Date('2026-09-01T00:00:00Z'),
};

/** Seed `n` winning bids for ORMVAH, each a clean 10% recovered rebate. */
async function seedWinningBids(
  intel: InMemoryIntelRepository,
  n: number,
): Promise<void> {
  const competitor = await intel.upsertCompetitor('STE GAGNANTE');
  for (let i = 0; i < n; i += 1) {
    await intel.insertResult(
      {
        reference: `AO ${i}/2025`,
        buyerName: 'ORMVAH',
        bidderName: 'STE GAGNANTE',
        amountMad: 900_000,
        estimationMad: 1_000_000,
        objet: "travaux d'irrigation",
        isWinner: true,
      },
      competitor.id,
    );
  }
}

describe('PricingService rebate calibration (integration)', () => {
  it('prices heuristically when no rebate history exists', async () => {
    const tenders = new InMemoryTenderRepository();
    const created = await tenders.create(TENDER);
    const service = new PricingService(tenders, new InMemoryIntelRepository());

    const result = await service.generateScenarios(created.id);

    expect(result.hypotheses.methode.toLowerCase()).toContain('heuristique');
    expect(result.recommandation.raison).not.toContain('historique');
    expect(result.scenarios.map((s) => s.rabaisPct)).toEqual([5, 12, 18]);
  });

  it('prices against the learned winning rabais once enough results accrue', async () => {
    const tenders = new InMemoryTenderRepository();
    const created = await tenders.create(TENDER);
    const intel = new InMemoryIntelRepository();
    await seedWinningBids(intel, 5);
    const service = new PricingService(tenders, intel);

    const result = await service.generateScenarios(created.id);

    expect(result.hypotheses.methode).toContain('N=5');
    expect(result.hypotheses.methode.toLowerCase()).toContain('calibr');
    expect(result.recommandation.raison).toContain('ORMVAH');
    expect(result.recommandation.raison).toContain('10%');
    // 5 winners all at 10% → the whole ladder anchors to 10%.
    expect(result.scenarios.every((s) => s.rabaisPct === 10)).toBe(true);
    expect(result.recommandation.nom).not.toBe('aucun');
  });

  it('degrades to heuristic pricing when the benchmark read fails', async () => {
    const tenders = new InMemoryTenderRepository();
    const created = await tenders.create(TENDER);

    class FailingIntel extends InMemoryIntelRepository {
      async rebateBenchmarks(): Promise<RebateBenchmarks> {
        throw new Error('intel indisponible');
      }
    }
    const service = new PricingService(tenders, new FailingIntel());

    const result = await service.generateScenarios(created.id);

    expect(result.hypotheses.methode.toLowerCase()).toContain('heuristique');
    expect(result.recommandation.nom).not.toBe('aucun');
  });
});
