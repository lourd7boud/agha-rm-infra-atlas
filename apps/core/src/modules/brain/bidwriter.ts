import { z } from 'zod';
import { parseModelJson } from './extractor';
import type { LlmClient } from './llm.client';

/**
 * Bid Writer (agent B2) — drafts the note méthodologique skeleton on the T2
 * model once a tender reaches GO. The draft is a starting point for the
 * Division Marchés, never a final document: unknowns are marked
 * [À COMPLÉTER: …] in place and listed in pointsAVerifier.
 */

export const bidDraftSchema = z.object({
  titre: z.string().min(5),
  sections: z
    .array(
      z.object({
        titre: z.string().min(3),
        contenu: z.string().min(20),
      }),
    )
    .min(4, 'au moins 4 sections attendues'),
  pointsAVerifier: z.array(z.string()),
});
export type BidDraft = z.infer<typeof bidDraftSchema>;

export const BID_WRITER_SYSTEM_PROMPT = `Tu es le Rédacteur d'Offres de la Division Marchés d'AGHA RM INFRA (entreprise marocaine de BTP/hydraulique).
On te fournit les données structurées d'un appel d'offres public marocain ayant reçu un GO.
Tu rédiges le SQUELETTE de la note méthodologique (mémoire technique) de la soumission.
RÈGLES ABSOLUES:
- Tu t'appuies UNIQUEMENT sur les données fournies. Tu n'inventes ni références, ni chiffres, ni matériel.
- Toute information manquante est marquée [À COMPLÉTER: description] dans le contenu ET listée dans pointsAVerifier.
- Sections attendues (adapter à l'objet du marché): présentation de l'entreprise, compréhension de l'objet,
  méthodologie d'exécution, moyens humains et matériels, planning d'exécution, qualité/hygiène/sécurité/environnement.
- Français professionnel des marchés publics marocains; les humains finalisent le document.
Tu réponds UNIQUEMENT avec un objet JSON valide:
{
  "titre": "Note méthodologique — <référence>",
  "sections": [{ "titre": "...", "contenu": "..." }],
  "pointsAVerifier": ["..."]
}`;

export interface DraftOutcome {
  ok: boolean;
  draft?: BidDraft;
  issues?: string[];
  raw: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Serializes the GO dossier handed to the model. */
export function buildDraftPrompt(dossier: Record<string, unknown>): string {
  return `Données de l'appel d'offres (JSON):\n${JSON.stringify(dossier, null, 2)}\n\nProduis le squelette de la note méthodologique.`;
}

export async function generateBidDraft(
  llm: LlmClient,
  dossier: Record<string, unknown>,
): Promise<DraftOutcome> {
  const completion = await llm.complete({
    tier: 'T2',
    system: BID_WRITER_SYSTEM_PROMPT,
    prompt: buildDraftPrompt(dossier),
    maxTokens: 3000,
    prefill: '{"titre": "',
  });

  let parsed: unknown;
  try {
    parsed = parseModelJson(completion.text, completion.prefill);
  } catch {
    return {
      ok: false,
      issues: ['Réponse non-JSON du modèle'],
      raw: completion.text,
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    };
  }

  const validated = bidDraftSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
      raw: completion.text,
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    };
  }

  return {
    ok: true,
    draft: validated.data,
    raw: completion.text,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
