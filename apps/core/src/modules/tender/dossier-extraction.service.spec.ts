import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import { InMemoryTenderRepository } from './tender.repository';
import { DossierExtractionService } from './dossier-extraction.service';

/**
 * extractBatch selects tenders that have a sourceUrl, are active, and are not yet
 * extracted (respecting force/upgrade + the failed-attempt cooldown), newest or
 * oldest first, bounded by `limit`. That candidate scan must ride a lean signal
 * projection (findDossierExtractionSignals) — NOT findAll(), which detoasts every
 * tender's `raw` jsonb (~97k rows) and can OOM the 792 MB core on a single run.
 */
describe('DossierExtractionService.extractBatch (candidate selection)', () => {
  const base = {
    buyerName: "Direction Régionale de l'Équipement de Marrakech",
    procedure: 'AOO' as const,
    objet: "Construction d'un pont sur oued N'Fis",
    location: 'Marrakech',
    deadlineAt: new Date('2026-12-01T09:00:00Z'),
  };

  test('selects sourceUrl+active+un-extracted candidates, never the whole-catalogue findAll (OOM guard)', async () => {
    const repo = new InMemoryTenderRepository();
    // 2 candidates: have a sourceUrl, future deadline, never extracted.
    await repo.create({ ...base, reference: 'AO 40/2026/A', sourceUrl: 'https://x/a' });
    await repo.create({ ...base, reference: 'AO 41/2026/B', sourceUrl: 'https://x/b' });
    // Non-candidate: no sourceUrl (nothing to download).
    await repo.create({ ...base, reference: 'AO 42/2026/C' });

    repo.findAll = () => {
      throw new Error('findAll() must not be called by extractBatch (OOM)');
    };

    const service = new DossierExtractionService(repo, new FakeLlmClient([]));
    // Stub the heavy per-tender extraction (downloads + parses the DCE) — this test
    // exercises candidate SELECTION, not the extraction itself.
    const extracted: string[] = [];
    (service as unknown as {
      extractTender: (id: string, opts: unknown) => Promise<unknown>;
    }).extractTender = async (id: string) => {
      extracted.push(id);
      return { extracted: true };
    };

    const result = await service.extractBatch(10, { onlyActive: true });

    expect(result.candidates).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(extracted).toHaveLength(2);
  });

  test('honours the failed-attempt cooldown and the --upgrade datao-field gate', async () => {
    const repo = new InMemoryTenderRepository();
    // A recent failed attempt (now) → inside the cooldown → skipped by default.
    const recent = await repo.create({ ...base, reference: 'AO 50/R', sourceUrl: 'https://x/r' });
    await repo.updateEnrichment(recent.id, {}, {
      dossierExtractAttempt: { at: new Date().toISOString() },
    });
    // A stale failed attempt → cooldown elapsed → eligible again.
    const stale = await repo.create({ ...base, reference: 'AO 51/S', sourceUrl: 'https://x/s' });
    await repo.updateEnrichment(stale.id, {}, {
      dossierExtractAttempt: { at: '2020-01-01T00:00:00.000Z' },
    });
    // Extracted WITH the datao 'autres' field → complete → never a candidate.
    const complete = await repo.create({ ...base, reference: 'AO 52/C', sourceUrl: 'https://x/c' });
    await repo.updateEnrichment(complete.id, {}, { dossierExtraction: { autres: [] } });
    // Extracted but PRE-datao (no 'autres') → candidate ONLY under --upgrade.
    const legacy = await repo.create({ ...base, reference: 'AO 53/L', sourceUrl: 'https://x/l' });
    await repo.updateEnrichment(legacy.id, {}, { dossierExtraction: { bpu: [] } });

    const service = new DossierExtractionService(repo, new FakeLlmClient([]));
    (service as unknown as {
      extractTender: (id: string, opts: unknown) => Promise<unknown>;
    }).extractTender = async () => ({ extracted: true });

    // Default: only 'stale' (un-extracted, cooldown elapsed). 'recent' is in
    // cooldown; 'complete'/'legacy' are already extracted.
    const def = await service.extractBatch(10, { onlyActive: false });
    expect(def.candidates).toBe(1);

    // --upgrade forces past the cooldown AND re-picks pre-datao extractions:
    // stale + recent (un-extracted) + legacy (lacks 'autres'); 'complete' excluded.
    const up = await service.extractBatch(10, { onlyActive: false, upgrade: true });
    expect(up.candidates).toBe(3);
  });
});
