import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import {
  aiExtractDossier,
  readDossierExtraction,
  resolvePortalFirstAmounts,
} from './dossier-extraction';

// Real RC wording so corroboration (the figure's digits must appear in the text)
// passes for legitimate values.
const RC_TEXT =
  'Estimation du maître d’ouvrage : 379 104,00 Dhs TTC. ' +
  'Le cautionnement provisoire est fixé à la somme de Sept Mille (7 000,00) dirhams.';

describe('aiExtractDossier', () => {
  test('extracts the hard financials, qualifications and BPU from dossier text', async () => {
    const json = JSON.stringify({
      estimationMad: 379104,
      cautionProvisoireMad: 7000,
      cautionDefinitivePct: 3,
      retenueGarantiePct: 7,
      delaiGarantieMois: 12,
      delaiExecutionMois: 4,
      chiffreAffairesMinMad: null,
      qualifications: [{ secteur: 'Bâtiment', qualification: 'B5', classe: '3' }],
      bpu: [{ designation: 'Béton armé', quantite: 100, unite: 'm3', prixUnitaireMad: 1200 }],
    });
    const llm = new FakeLlmClient([json]);

    const out = await aiExtractDossier(llm, RC_TEXT, ['RC.pdf'], {
      reference: '06/BR/RGON/2026',
    });

    expect(out.estimationMad).toBe(379104);
    expect(out.cautionProvisoireMad).toBe(7000);
    expect(out.cautionDefinitivePct).toBe(3);
    expect(out.delaiExecutionMois).toBe(4);
    expect(out.qualifications).toEqual([
      { secteur: 'Bâtiment', qualification: 'B5', classe: '3' },
    ]);
    expect(out.bpu[0]!.prixUnitaireMad).toBe(1200);
    expect(out.model).toBe('fake-T1');
    expect(out.sourceFiles).toEqual(['RC.pdf']);
    expect(typeof out.extractedAt).toBe('string');
    expect(llm.requests[0]!.prompt).toContain('Estimation du maître');
  });

  test('drops a money figure that does NOT appear in the dossier text (anti-hallucination)', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ estimationMad: 999999, cautionProvisoireMad: 7000, bpu: [], qualifications: [] }),
    ]);
    const out = await aiExtractDossier(llm, RC_TEXT, ['RC.pdf']);
    expect(out.estimationMad).toBeNull(); // 999999 is nowhere in the text → rejected
    expect(out.cautionProvisoireMad).toBe(7000); // 7000 is corroborated
  });

  test('coerces an implausible/zero figure to null (sans caution)', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ estimationMad: 379104, cautionProvisoireMad: 0, bpu: [], qualifications: [] }),
    ]);
    const out = await aiExtractDossier(llm, RC_TEXT, ['RC.pdf']);
    expect(out.estimationMad).toBe(379104);
    expect(out.cautionProvisoireMad).toBeNull(); // 0 < band floor → null
  });

  test('truncates over-long lists instead of rejecting the whole extraction', async () => {
    const quals = Array.from({ length: 65 }, (_, i) => ({ qualification: `Q${i}` }));
    const bpu = Array.from({ length: 320 }, (_, i) => ({ designation: `Poste ${i}` }));
    const llm = new FakeLlmClient([JSON.stringify({ qualifications: quals, bpu })]);
    const out = await aiExtractDossier(llm, RC_TEXT, []);
    expect(out.qualifications).toHaveLength(60); // capped, not rejected
    expect(out.bpu).toHaveLength(300);
  });

  test('defaults arrays and leaves absent figures empty', async () => {
    const llm = new FakeLlmClient([JSON.stringify({})]);
    const out = await aiExtractDossier(llm, RC_TEXT, []);
    expect(out.estimationMad ?? null).toBeNull();
    expect(out.qualifications).toEqual([]);
    expect(out.bpu).toEqual([]);
  });

  test('throws a clean 503 on non-JSON model output', async () => {
    const llm = new FakeLlmClient(['désolé, je ne peux pas']);
    await expect(aiExtractDossier(llm, RC_TEXT, [])).rejects.toThrow();
  });

  test('readDossierExtraction round-trips a stored envelope', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ estimationMad: 500000, bpu: [], qualifications: [] }),
    ]);
    const out = await aiExtractDossier(llm, 'Estimation : 500 000,00 DH', ['CPS.pdf']);
    const back = readDossierExtraction({ dossierExtraction: out });
    expect(back?.estimationMad).toBe(500000);
    expect(readDossierExtraction({})).toBeNull();
    expect(readDossierExtraction(null)).toBeNull();
  });
});

describe('resolvePortalFirstAmounts', () => {
  test('the DCE fills only money columns the portal left empty', () => {
    const amounts = resolvePortalFirstAmounts(
      { estimationMad: null, cautionProvisoireMad: null },
      { estimationMad: 379104, cautionProvisoireMad: 7000 },
    );
    expect(amounts).toEqual({ estimationMad: 379104, cautionProvisoireMad: 7000 });
  });

  test('never overwrites a portal-supplied estimation, even when the DCE disagrees', () => {
    const amounts = resolvePortalFirstAmounts(
      { estimationMad: 1399968, cautionProvisoireMad: null },
      { estimationMad: 1400000, cautionProvisoireMad: 27000 },
    );
    // Portal estimation kept (not in the write set); caution filled from the DCE.
    expect(amounts).toEqual({ cautionProvisoireMad: 27000 });
  });

  test('emits an empty write set when the portal already has both figures', () => {
    const amounts = resolvePortalFirstAmounts(
      { estimationMad: 500000, cautionProvisoireMad: 10000 },
      { estimationMad: 490000, cautionProvisoireMad: 9000 },
    );
    expect(amounts).toEqual({});
  });

  test('ignores null DCE figures (no column written from a missing value)', () => {
    const amounts = resolvePortalFirstAmounts(
      { estimationMad: null, cautionProvisoireMad: null },
      { estimationMad: null, cautionProvisoireMad: null },
    );
    expect(amounts).toEqual({});
  });
});
