import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from './llm.client';
import { buildBriefPrompt, generateBrief } from './strategist';

const VALID_BRIEF = JSON.stringify({
  recommandation: 'GO_SOUS_CONDITIONS',
  confiance: 0.7,
  synthese:
    'Marché aligné avec nos métiers hydrauliques avec un délai de préparation confortable.',
  argumentsPour: ['Objet irrigation dans notre cœur de métier'],
  risques: ['Estimation non publiée'],
  verifications: ['Vérifier la caution provisoire au DCE'],
});

describe('buildBriefPrompt', () => {
  test('embeds the dossier as JSON', () => {
    const prompt = buildBriefPrompt({ reference: 'AO 1/2026/X' });
    expect(prompt).toContain('"reference": "AO 1/2026/X"');
    expect(prompt).toContain('Go/No-Go');
  });
});

describe('generateBrief', () => {
  test('returns a typed brief on the T3 tier for valid output', async () => {
    const llm = new FakeLlmClient([VALID_BRIEF]);
    const outcome = await generateBrief(llm, { reference: 'AO 1/2026/X' });

    expect(outcome.ok).toBe(true);
    expect(outcome.brief?.recommandation).toBe('GO_SOUS_CONDITIONS');
    expect(outcome.brief?.confiance).toBe(0.7);
    expect(llm.requests[0]?.tier).toBe('T3');
  });

  test('flags invalid recommendations', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ recommandation: 'PEUT-ETRE', confiance: 2 }),
    ]);
    const outcome = await generateBrief(llm, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.join(' ')).toContain('recommandation');
  });
});
