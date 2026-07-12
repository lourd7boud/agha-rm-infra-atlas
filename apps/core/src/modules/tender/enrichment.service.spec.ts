import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import { InMemoryTenderRepository } from './tender.repository';
import { EnrichmentService } from './enrichment.service';

/**
 * generateG1Brief (POST /tender/tenders/:id/brief) enriches the Strategist's
 * dossier with the buyer's observed market context. That context only needs the
 * lean 6-column observation projection (buildMarketContext is typed for
 * `BuyerObservationRow[]`), so the handler must ride `findBuyerObservationRows()`
 * — NOT `findAll()`, which detoasts every tender's `raw` jsonb (~97k rows) and
 * OOM-crashes the 792 MB core on a single request. This test poisons the heavy
 * loader so it fails the day someone reintroduces the whole-catalogue fold here.
 */
describe('EnrichmentService.generateG1Brief (market context)', () => {
  async function seedSameBuyer(repo: InMemoryTenderRepository): Promise<string> {
    const target = await repo.create({
      reference: 'AO 12/2026/DRETLH',
      buyerName: "Direction Régionale de l'Équipement de Marrakech",
      procedure: 'AOO',
      objet: "Construction d'un pont sur oued N'Fis",
      location: 'Marrakech',
      deadlineAt: new Date('2026-09-01T09:00:00Z'),
      sourceUrl: 'https://x/1',
    });
    // A second tender for the SAME buyer so the observed profile is non-empty.
    await repo.create({
      reference: 'AO 19/2026/DRETLH',
      buyerName: "Direction Régionale de l'Équipement de Marrakech",
      procedure: 'AOO',
      objet: "Réhabilitation d'une conduite d'eau à Marrakech",
      location: 'Marrakech',
      deadlineAt: new Date('2026-10-01T09:00:00Z'),
      sourceUrl: 'https://x/2',
    });
    return target.id;
  }

  const validBriefJson = JSON.stringify({
    recommandation: 'GO',
    confiance: 0.7,
    synthese: 'Analyse favorable du marché sur la base des données fournies.',
    argumentsPour: ['Objet aligné au métier'],
    risques: ['Délai court'],
    verifications: ['Confirmer la caution provisoire'],
  });

  test('builds market context from the lean observation projection, never findAll (OOM guard)', async () => {
    const repo = new InMemoryTenderRepository();
    const id = await seedSameBuyer(repo);
    // Poison the heavy loader — findAll() detoasts every `raw` jsonb (OOM on prod).
    repo.findAll = () => {
      throw new Error('findAll() must not be called by generateG1Brief (OOM)');
    };
    const llm = new FakeLlmClient([validBriefJson]);

    const outcome = await new EnrichmentService(repo, llm).generateG1Brief(id);

    expect(outcome.ok).toBe(true);
    // The market context reached the model — proof buildMarketContext ran over the
    // observation rows (profilAcheteur is only populated from observed history).
    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('marcheIntel');
    expect(prompt).toContain('profilAcheteur');
    expect(prompt).toContain('nbAppelsObserves');
  });
});

/**
 * aiEnrichBatch selects un-enriched active tenders newest-first, bounded by
 * `limit`, and enriches them. The candidate scan must ride a lean projection
 * (findAiEnrichmentCandidates) — NOT findAll(), which detoasts every tender's
 * `raw` jsonb (~97k rows) and can OOM the 792 MB core on a single batch run.
 */
describe('EnrichmentService.aiEnrichBatch (candidate selection)', () => {
  const base = {
    buyerName: "Direction Régionale de l'Équipement de Marrakech",
    procedure: 'AOO' as const,
    // Shared objet so any enrichment résumé passes the overlap guard regardless
    // of which candidate the pool happens to hand each queued response to.
    objet: "Construction d'un pont sur oued N'Fis",
    location: 'Marrakech',
    deadlineAt: new Date('2026-12-01T09:00:00Z'),
  };
  // Résumé echoes the objet tokens so jaccardOverlap clears MIN_RESUME_OVERLAP.
  const enrichJson = JSON.stringify({
    secteur: 'Génie civil',
    resume: "Marché de construction d'un pont sur oued. Ouvrage de génie civil.",
    faq: [],
    lots: [],
    conditions: {},
    reserveAuxPme: false,
  });

  test('enriches only un-enriched active tenders, never the whole-catalogue findAll (OOM guard)', async () => {
    const repo = new InMemoryTenderRepository();
    await repo.create({ ...base, reference: 'AO 30/2026/A', sourceUrl: 'https://x/a' });
    await repo.create({ ...base, reference: 'AO 31/2026/B', sourceUrl: 'https://x/b' });
    // Already enriched → must be skipped.
    const enriched = await repo.create({
      ...base,
      reference: 'AO 32/2026/C',
      sourceUrl: 'https://x/c',
    });
    await repo.updateEnrichment(enriched.id, {}, {
      aiEnrichment: {
        secteur: 'Génie civil',
        resume: 'Déjà enrichi.',
        faq: [],
        lots: [],
        conditions: {},
        reserveAuxPme: false,
        model: 'fake-T1',
        enrichedAt: '2026-07-10T00:00:00.000Z',
      },
    });

    repo.findAll = () => {
      throw new Error('findAll() must not be called by aiEnrichBatch (OOM)');
    };
    // One queued response per candidate (2), consumed by the worker pool.
    const llm = new FakeLlmClient([enrichJson, enrichJson]);

    const result = await new EnrichmentService(repo, llm).aiEnrichBatch(100, {
      onlyActive: true,
    });

    expect(result.candidates).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  test('caps the candidate set at `limit`', async () => {
    const repo = new InMemoryTenderRepository();
    await repo.create({ ...base, reference: 'AO 60/1', sourceUrl: 'https://x/1' });
    await repo.create({ ...base, reference: 'AO 61/2', sourceUrl: 'https://x/2' });
    await repo.create({ ...base, reference: 'AO 62/3', sourceUrl: 'https://x/3' });
    // Exactly one response: if `limit` were not honoured the 2nd enrich would
    // exhaust the queue and fail, so candidates=1/succeeded=1 proves the cap.
    const llm = new FakeLlmClient([enrichJson]);

    const result = await new EnrichmentService(repo, llm).aiEnrichBatch(1, {
      onlyActive: true,
    });

    expect(result.candidates).toBe(1);
    expect(result.succeeded).toBe(1);
  });
});
