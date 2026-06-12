import { describe, expect, test } from 'vitest';
import { buildEstimatePrompt, generateEstimateSkeleton } from './estimator';
import { FakeLlmClient } from './llm.client';

const VALID_SKELETON = JSON.stringify({
  titre: 'Détail estimatif — AO 23/2026/DRETLH',
  postes: [
    {
      designation: 'Installation et repli de chantier',
      unite: 'forfait',
      commentaire: 'Inclut amenée du matériel et baraquements.',
    },
    {
      designation: 'Déblais en terrain de toute nature',
      unite: 'm3',
      commentaire: '[À COMPLÉTER: volume selon métré du DCE]',
    },
    {
      designation: 'Béton armé pour semelles de fondation',
      unite: 'm3',
      commentaire: '[À COMPLÉTER: dosage et volume selon plans]',
    },
    {
      designation: 'Acier pour béton armé',
      unite: 'kg',
      commentaire: '[À COMPLÉTER: ratio selon étude BA]',
    },
    {
      designation: 'Tablier en béton précontraint',
      unite: 'm2',
      commentaire: '[À COMPLÉTER: surface selon plans]',
    },
  ],
  hypotheses: ['Structure type pont à poutres, à confirmer au DCE'],
  pointsAVerifier: ['Récupérer le bordereau des prix officiel du DCE'],
});

describe('buildEstimatePrompt', () => {
  test('embeds the dossier as JSON', () => {
    const prompt = buildEstimatePrompt({ reference: 'AO 9/2026/X' });
    expect(prompt).toContain('"reference": "AO 9/2026/X"');
    expect(prompt).toContain('détail estimatif');
  });
});

describe('generateEstimateSkeleton', () => {
  test('returns a typed skeleton on the T2 tier without any price', async () => {
    const llm = new FakeLlmClient([VALID_SKELETON]);
    const outcome = await generateEstimateSkeleton(llm, {
      reference: 'AO 9/2026/X',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.skeleton?.postes.length).toBeGreaterThanOrEqual(5);
    expect(llm.requests[0]?.tier).toBe('T2');
    // anti-invention: the schema has no price field at all
    expect(JSON.stringify(outcome.skeleton)).not.toMatch(/prixUnitaire|montant/);
  });

  test('rejects skeletons with too few line items', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        titre: 'Détail estimatif',
        postes: [
          { designation: 'Poste unique', unite: 'forfait', commentaire: 'x' },
        ],
        hypotheses: [],
        pointsAVerifier: [],
      }),
    ]);
    const outcome = await generateEstimateSkeleton(llm, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.join(' ')).toContain('postes');
  });
});
