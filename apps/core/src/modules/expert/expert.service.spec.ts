import { describe, expect, test } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  LlmClient,
  LlmCompletion,
  LlmRequest,
} from '../brain/llm.client';
import { InMemoryIntelRepository } from '../intel/intel.repository';
import { InMemoryTenderRepository } from '../tender/tender.repository';
import type { VaultDocumentRecord, VaultRepository } from '../vault/vault.repository';
import { ExpertService } from './expert.service';

const AVIS_JSON = JSON.stringify({
  synthese: 'Consultation alignée sur les métiers hydrauliques de la société.',
  atouts: ['Segment maîtrisé'],
  risques: ['Concurrence locale'],
  pointsVigilance: ['Vérifier la caution'],
  goNoGo: { verdict: 'go', confiancePct: 70, raisons: ['Marché accessible'] },
});

class FakeLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(
    private readonly bpuPrices: Array<number | null> = [1000, 20],
  ) {}

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    // Pricing + avis both run at tier T3 now, so branch on the response schema:
    // the BPU-pricing call carries a `prix` property, the avis call a `goNoGo`.
    const props = (
      request.responseSchema as { properties?: Record<string, unknown> } | undefined
    )?.properties;
    const isBpu = props ? 'prix' in props : false;
    const text = isBpu ? JSON.stringify({ prix: this.bpuPrices }) : AVIS_JSON;
    return { text, model: 'fake-model', inputTokens: 10, outputTokens: 10 };
  }

  /** BPU unit-price completions the fake received (vs avis completions). */
  get bpuCalls(): LlmRequest[] {
    return this.calls.filter((c) => {
      const props = (c.responseSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties;
      return props ? 'prix' in props : false;
    });
  }

  async completeVision(): Promise<LlmCompletion> {
    throw new Error('not used');
  }

  async completeVisionDoc(): Promise<LlmCompletion> {
    throw new Error('not used');
  }
}

class FakeVault implements VaultRepository {
  constructor(private readonly docs: VaultDocumentRecord[]) {}
  async create(): Promise<VaultDocumentRecord> {
    throw new Error('not used');
  }
  async findAll(): Promise<VaultDocumentRecord[]> {
    return this.docs;
  }
  async findById(): Promise<VaultDocumentRecord | null> {
    return null;
  }
  async updateFile(): Promise<VaultDocumentRecord | null> {
    return null;
  }
}

async function seedTender(
  repo: InMemoryTenderRepository,
  opts: { estimation?: number; bpu?: boolean } = {},
) {
  const created = await repo.create({
    reference: 'AO 9/2026',
    buyerName: 'ORMVA DE TEST',
    procedure: 'AOO',
    objet: "Travaux d'aménagement hydro-agricole du périmètre",
    deadlineAt: new Date('2026-09-01T10:00:00Z'),
    ...(opts.estimation !== undefined ? { estimationMad: opts.estimation } : {}),
    cautionProvisoireMad: 15_000,
  });
  if (opts.bpu) {
    await repo.updateEnrichment(created.id, {}, {
      dossierExtraction: {
        model: 'test',
        extractedAt: '2026-07-01T00:00:00.000Z',
        bpu: [
          { designation: 'Terrassement en masse', quantite: 100, unite: 'm3' },
          { designation: 'Conduite PVC DN200', quantite: 500, unite: 'ml' },
        ],
        qualifications: [{ qualification: 'C5', classe: '4' }],
      },
    });
  }
  return created;
}

function makeService(overrides: {
  tenders?: InMemoryTenderRepository;
  intel?: InMemoryIntelRepository;
  llm?: LlmClient | null;
  vault?: VaultRepository | null;
} = {}) {
  return new ExpertService(
    overrides.tenders ?? new InMemoryTenderRepository(),
    overrides.intel ?? new InMemoryIntelRepository(),
    overrides.llm !== undefined ? overrides.llm : new FakeLlm(),
    overrides.vault !== undefined ? overrides.vault : null,
  );
}

describe('ExpertService.analyzeTender', () => {
  test('produces a full analysis with deterministic scenarios and LLM avis', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 2_000_000 });
    const service = makeService({ tenders });

    const analysis = await service.analyzeTender(tender.id);

    expect(analysis.reference).toBe('AO 9/2026');
    expect(analysis.estimationMad).toBe(2_000_000);
    expect(analysis.scenarios).not.toBeNull();
    expect(analysis.rabais.recommandePct).not.toBeNull();
    expect(analysis.competition.base).toBe('hypothese'); // no published results yet
    expect(analysis.avisExpert?.goNoGo.verdict).toBe('go');
    expect(analysis.avisExpert?.model).toBe('fake-model');

    // Persisted on the tender for later reads.
    const stored = await service.getAnalysis(tender.id);
    expect(stored.generatedAt).toBe(analysis.generatedAt);
  });

  test('degrades without estimation: no scenarios, explicit warning', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders);
    const service = makeService({ tenders });

    const analysis = await service.analyzeTender(tender.id);

    expect(analysis.scenarios).toBeNull();
    expect(analysis.rabais.recommandePct).toBeNull();
    expect(analysis.avertissements.some((w) => w.includes('Estimation'))).toBe(true);
  });

  test('keeps the numeric analysis when the LLM is offline', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 1_000_000 });
    const service = makeService({ tenders, llm: null });

    const analysis = await service.analyzeTender(tender.id);

    expect(analysis.scenarios).not.toBeNull();
    expect(analysis.avisExpert).toBeNull();
  });

  test('404 on unknown tender', async () => {
    const service = makeService();
    await expect(service.analyzeTender('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ExpertService.proposeBpu', () => {
  test('prices every line, calibrated on estimation × (1 − rabais)', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 1_000_000, bpu: true });
    const service = makeService({ tenders });

    const proposal = await service.proposeBpu(tender.id, { rabaisPct: 10 });

    expect(proposal.methode).toBe('calibre_estimation');
    expect(proposal.targetTotalMad).toBe(900_000);
    expect(Math.abs(proposal.totalMad - 900_000)).toBeLessThanOrEqual(1);
    expect(proposal.lines).toHaveLength(2);
    expect(proposal.model).toBe('fake-model');

    const stored = await service.getBpu(tender.id);
    expect(stored.totalMad).toBe(proposal.totalMad);
  });

  test('forfait fallback: no line-item BPU but an estimation → single objet line', async () => {
    // A lump-sum / "article unique" consultation (e.g. one vehicle) whose DCE
    // carries no detailed estimatif: the agent must still fill a usable bordereau
    // — one forfait line built from the objet, calibrated on the estimation.
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 300_000 });
    const service = makeService({ tenders });

    const proposal = await service.proposeBpu(tender.id, { rabaisPct: 0 });

    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]!.designation).toContain('aménagement');
    expect(Math.abs(proposal.totalMad - 300_000)).toBeLessThanOrEqual(1);
    expect(proposal.avertissements.some((w) => w.toLowerCase().includes('forfait'))).toBe(true);
  });

  test('409 only when there is neither a BPU nor an estimation to price against', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders); // no estimation, no bpu
    const service = makeService({ tenders });

    await expect(service.proposeBpu(tender.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  test('uniform fallback when the LLM is offline but estimation exists', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 600_000, bpu: true });
    const service = makeService({ tenders, llm: null });

    const proposal = await service.proposeBpu(tender.id, { rabaisPct: 0 });

    expect(proposal.methode).toBe('repartition_uniforme');
    expect(Math.abs(proposal.totalMad - 600_000)).toBeLessThanOrEqual(1);
  });

  test('prices from the DCE estimatif itself, without consulting the LLM', async () => {
    const tenders = new InMemoryTenderRepository();
    const created = await tenders.create({
      reference: 'AO 10/2026',
      buyerName: 'ORMVA DE TEST',
      procedure: 'AOO',
      objet: 'Travaux hydrauliques',
      deadlineAt: new Date('2026-09-01T10:00:00Z'),
      estimationMad: 1_000_000,
      cautionProvisoireMad: 10_000,
    });
    await tenders.updateEnrichment(created.id, {}, {
      dossierExtraction: {
        model: 'test',
        extractedAt: '2026-07-01T00:00:00.000Z',
        bpu: [
          { designation: 'Terrassement en masse', quantite: 100, unite: 'm3', prixUnitaireMad: 50 },
          { designation: 'Béton dosé à 350', quantite: 20, unite: 'm3', prixUnitaireMad: 1200 },
        ],
        qualifications: [],
      },
    });
    const llm = new FakeLlm();
    const service = makeService({ tenders, llm });

    const proposal = await service.proposeBpu(created.id, { rabaisPct: 0 });

    expect(proposal.pricingBasis).toEqual({ dce: 2, historique: 0, ia: 0, aucune: 0 });
    expect(llm.bpuCalls).toHaveLength(0); // priced from the DCE — LLM not consulted
    expect(proposal.model).toBeNull();
    expect(proposal.methode).toBe('calibre_estimation');
  });

  test('learns a unit price from a past estimatif when the DCE has none', async () => {
    const tenders = new InMemoryTenderRepository();
    // A past dossier whose estimatif carried a real unit price → seeds the book.
    const past = await tenders.create({
      reference: 'AO 3/2025',
      buyerName: 'ORMVA HISTORIQUE',
      procedure: 'AOO',
      objet: 'Travaux antérieurs',
      deadlineAt: new Date('2025-06-01T10:00:00Z'),
    });
    await tenders.updateEnrichment(past.id, {}, {
      dossierExtraction: {
        model: 'test',
        extractedAt: '2025-06-01T00:00:00.000Z',
        bpu: [
          { designation: 'Terrassement en masse', quantite: 1, unite: 'm3', prixUnitaireMad: 55 },
        ],
        qualifications: [],
      },
    });
    // Target: same work but the DCE published no unit price (bpu:true = unpriced).
    const target = await seedTender(tenders, { estimation: 500_000, bpu: true });
    const llm = new FakeLlm([999, 999]);
    const service = makeService({ tenders, llm });

    const proposal = await service.proposeBpu(target.id, { rabaisPct: 0 });

    // "Terrassement en masse" priced from history; "Conduite PVC DN200" from IA.
    expect(proposal.pricingBasis!.historique).toBe(1);
    expect(proposal.pricingBasis!.ia).toBe(1);
  });
});

describe('ExpertService.adminDossier', () => {
  test('builds the checklist from vault readiness + extraction + BPU total', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders, { estimation: 1_000_000, bpu: true });
    const vault = new FakeVault([
      {
        id: 'd1',
        kind: 'registre_commerce',
        label: 'RC',
        createdAt: new Date(),
      } as VaultDocumentRecord,
    ]);
    const service = makeService({ tenders, vault });

    await service.proposeBpu(tender.id, { rabaisPct: 10 });
    const dossier = await service.adminDossier(tender.id);

    expect(dossier.reference).toBe('AO 9/2026');
    const byCode = new Map(dossier.pieces.map((p) => [p.code, p]));
    expect(byCode.get('registre_commerce')!.statut).toBe('disponible');
    expect(byCode.get('attestation_fiscale')!.statut).toBe('a_fournir');
    expect(dossier.qualificationsRequises).toHaveLength(1);
    expect(dossier.acteEngagement.montantMad).toBeCloseTo(900_000, 0);
    expect(dossier.acteEngagement.montantEnLettres).toContain('dirhams');
    expect(dossier.cautionProvisoireMad).toBe(15_000);
  });

  test('works without a vault (everything à fournir)', async () => {
    const tenders = new InMemoryTenderRepository();
    const tender = await seedTender(tenders);
    const service = makeService({ tenders, vault: null });

    const dossier = await service.adminDossier(tender.id);
    expect(dossier.readinessScore).toBe(0);
    expect(dossier.ready).toBe(false);
  });
});

describe('ExpertService.getKnowledge', () => {
  test('aggregates and caches within the TTL', async () => {
    const tenders = new InMemoryTenderRepository();
    await seedTender(tenders, { estimation: 1_000_000 });
    let findAllCalls = 0;
    const originalFindAll = tenders.findAllForKnowledge.bind(tenders);
    tenders.findAllForKnowledge = async () => {
      findAllCalls += 1;
      return originalFindAll();
    };
    const service = makeService({ tenders });

    const first = await service.getKnowledge(new Date('2026-07-02T12:00:00Z'));
    const second = await service.getKnowledge(new Date('2026-07-02T12:01:00Z'));

    expect(first.marche.tendersTotal).toBe(1);
    expect(second).toBe(first); // cached object
    expect(findAllCalls).toBe(1);
  });
});
