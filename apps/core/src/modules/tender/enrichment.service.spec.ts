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
