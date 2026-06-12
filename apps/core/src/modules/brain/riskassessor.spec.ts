import { describe, expect, test } from 'vitest';
import { FakeLlmClient } from './llm.client';
import { assessRisks, buildRiskPrompt } from './riskassessor';

const VALID_ASSESSMENT = JSON.stringify({
  niveauGlobal: 'moyen',
  synthese:
    'Marché de pont en site oued: risques hydrologiques et géotechniques dominants.',
  risques: [
    {
      categorie: 'technique',
      description: 'Fondations en lit d’oued sans données géotechniques fournies.',
      gravite: 'elevee',
      probabilite: 'moyenne',
      mitigation: 'Exiger la campagne géotechnique avant remise de prix.',
    },
    {
      categorie: 'delai',
      description: 'Fenêtre de travaux contrainte par la saison des crues.',
      gravite: 'moyenne',
      probabilite: 'elevee',
      mitigation: 'Planifier la dérivation et les fondations en étiage.',
    },
    {
      categorie: 'administratif',
      description: 'Qualifications Secteur B Classe 3 à confirmer côté entreprise.',
      gravite: 'elevee',
      probabilite: 'faible',
      mitigation: 'Vérifier le certificat de qualification avant G2.',
    },
  ],
});

describe('buildRiskPrompt', () => {
  test('embeds the dossier as JSON', () => {
    const prompt = buildRiskPrompt({ reference: 'AO 9/2026/X' });
    expect(prompt).toContain('"reference": "AO 9/2026/X"');
    expect(prompt).toContain('analyse des risques');
  });
});

describe('assessRisks', () => {
  test('returns a typed assessment on the T2 tier', async () => {
    const llm = new FakeLlmClient([VALID_ASSESSMENT]);
    const outcome = await assessRisks(llm, { reference: 'AO 9/2026/X' });

    expect(outcome.ok).toBe(true);
    expect(outcome.assessment?.niveauGlobal).toBe('moyen');
    expect(outcome.assessment?.risques).toHaveLength(3);
    expect(llm.requests[0]?.tier).toBe('T2');
  });

  test('rejects unknown categories and levels', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        niveauGlobal: 'apocalyptique',
        synthese: 'Synthèse suffisante ici.',
        risques: [],
      }),
    ]);
    const outcome = await assessRisks(llm, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.join(' ')).toContain('niveauGlobal');
  });
});
