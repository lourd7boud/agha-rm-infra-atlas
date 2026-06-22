import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import {
  aiEnrich,
  buildEnrichmentPrompt,
  readAiEnrichment,
  runPool,
} from './ai-enrichment';

const VALID = JSON.stringify({
  secteur: 'Eau potable et assainissement',
  resume:
    'Travaux de maintenance des réseaux d’eau potable. Objectif: pérennité des infrastructures.',
  faq: [{ question: 'Quelle qualification ?', reponse: 'Classe et secteur AEP exigés.' }],
  lots: [{ designation: 'Lot 1', description: 'Réseau primaire' }],
  conditions: { cautionDefinitivePct: 3, retenueGarantiePct: 10, delaiGarantieMois: 12 },
  reserveAuxPme: false,
});

describe('buildEnrichmentPrompt', () => {
  test('includes the known fields, skips unknown ones', () => {
    const prompt = buildEnrichmentPrompt({
      objet: 'Travaux X',
      buyerName: 'Commune Y',
      procedureLabel: "Appel d'offres ouvert",
      category: 'Travaux',
    });
    expect(prompt).toContain('Acheteur: Commune Y');
    expect(prompt).toContain('Objet: Travaux X');
    expect(prompt).not.toContain('Caution provisoire');
    expect(prompt).not.toContain('Qualifications');
  });

  test('adds caution and qualifications when provided', () => {
    const prompt = buildEnrichmentPrompt({
      objet: 'X',
      buyerName: 'Y',
      procedureLabel: 'P',
      category: 'Travaux',
      cautionProvisoireMad: 4000,
      qualificationsRequises: ['Secteur A', 'Classe 3'],
    });
    expect(prompt).toContain('Caution provisoire connue (DH): 4000');
    expect(prompt).toContain('Qualifications exigées: Secteur A ; Classe 3');
  });
});

describe('aiEnrich', () => {
  const input = {
    objet: 'Travaux',
    buyerName: 'Commune',
    procedureLabel: 'AOO',
    category: 'Travaux',
  };

  test('parses + validates the model JSON and stamps provenance', async () => {
    const llm = new FakeLlmClient([VALID]);
    const out = await aiEnrich(llm, input);
    expect(out.secteur).toBe('Eau potable et assainissement');
    expect(out.faq).toHaveLength(1);
    expect(out.lots).toHaveLength(1);
    expect(out.conditions.cautionDefinitivePct).toBe(3);
    expect(out.model).toBe('fake-T1');
    expect(typeof out.enrichedAt).toBe('string');
    // Bulk/fast tier.
    expect(llm.requests[0]!.tier).toBe('T1');
  });

  test('tolerates fenced JSON output', async () => {
    const llm = new FakeLlmClient(['```json\n' + VALID + '\n```']);
    const out = await aiEnrich(llm, input);
    expect(out.secteur).toBeTruthy();
  });

  test('throws on schema-invalid output (never stores bad data)', async () => {
    const llm = new FakeLlmClient([JSON.stringify({ secteur: '', resume: '' })]);
    await expect(aiEnrich(llm, input)).rejects.toThrow();
  });

  test('applies defaults for omitted optional fields', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ secteur: 'Génie civil', resume: 'Un résumé minimal.' }),
    ]);
    const out = await aiEnrich(llm, input);
    expect(out.faq).toEqual([]);
    expect(out.lots).toEqual([]);
    expect(out.reserveAuxPme).toBe(false);
  });
});

describe('readAiEnrichment', () => {
  test('round-trips a stored enrichment', async () => {
    const llm = new FakeLlmClient([VALID]);
    const out = await aiEnrich(llm, {
      objet: 'X',
      buyerName: 'Y',
      procedureLabel: 'P',
      category: 'Travaux',
    });
    const read = readAiEnrichment({ aiEnrichment: out, detail: { categorie: 'AEP' } });
    expect(read?.secteur).toBe(out.secteur);
    expect(read?.model).toBe('fake-T1');
  });

  test('returns null for missing or invalid envelopes', () => {
    expect(readAiEnrichment(null)).toBeNull();
    expect(readAiEnrichment({})).toBeNull();
    // Missing provenance (model/enrichedAt) → rejected.
    expect(readAiEnrichment({ aiEnrichment: { secteur: 'x', resume: 'y' } })).toBeNull();
  });
});

describe('runPool', () => {
  test('processes every item within the concurrency cap', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const done: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool(items, 5, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      done.push(n);
      inFlight -= 1;
    });
    expect(done.sort((a, b) => a - b)).toEqual(items);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  test('empty input is a no-op', async () => {
    await expect(runPool([], 5, async () => {})).resolves.toBeUndefined();
  });
});
