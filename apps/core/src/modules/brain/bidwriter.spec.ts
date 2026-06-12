import { describe, expect, test } from 'vitest';
import { buildDraftPrompt, generateBidDraft } from './bidwriter';
import { FakeLlmClient } from './llm.client';

const VALID_DRAFT = JSON.stringify({
  titre: 'Note méthodologique — AO 23/2026/DRETLH',
  sections: [
    {
      titre: "Présentation de l'entreprise",
      contenu:
        'AGHA RM INFRA, entreprise marocaine de BTP. [À COMPLÉTER: références similaires]',
    },
    {
      titre: "Compréhension de l'objet du marché",
      contenu: "Construction d'un pont sur oued, province concernée.",
    },
    {
      titre: "Méthodologie d'exécution",
      contenu: 'Phasage: installation de chantier, fondations, tablier, finitions.',
    },
    {
      titre: 'Moyens humains et matériels',
      contenu: '[À COMPLÉTER: liste du matériel affecté au chantier]',
    },
  ],
  pointsAVerifier: ['Confirmer le délai d’exécution au CPS'],
});

describe('buildDraftPrompt', () => {
  test('embeds the dossier as JSON', () => {
    const prompt = buildDraftPrompt({ reference: 'AO 9/2026/X' });
    expect(prompt).toContain('"reference": "AO 9/2026/X"');
    expect(prompt).toContain('note méthodologique');
  });
});

describe('generateBidDraft', () => {
  test('returns a typed draft on the T2 tier for valid output', async () => {
    const llm = new FakeLlmClient([VALID_DRAFT]);
    const outcome = await generateBidDraft(llm, { reference: 'AO 9/2026/X' });

    expect(outcome.ok).toBe(true);
    expect(outcome.draft?.sections).toHaveLength(4);
    expect(outcome.draft?.titre).toContain('Note méthodologique');
    expect(llm.requests[0]?.tier).toBe('T2');
  });

  test('rejects drafts with too few sections', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        titre: 'Note',
        sections: [{ titre: 'Seule section', contenu: 'Contenu suffisant ici.' }],
        pointsAVerifier: [],
      }),
    ]);
    const outcome = await generateBidDraft(llm, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.join(' ')).toContain('sections');
  });

  test('reports non-JSON output as an issue', async () => {
    const llm = new FakeLlmClient(['Voici votre note en Markdown...']);
    const outcome = await generateBidDraft(llm, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.[0]).toContain('non-JSON');
  });
});
