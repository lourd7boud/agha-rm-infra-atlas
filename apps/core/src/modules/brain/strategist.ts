import { z } from 'zod';
import { parseModelJson } from './extractor';
import type { LlmClient } from './llm.client';

/**
 * Strategist (agent A4) — produces the G1 Go/No-Go brief on the T3 model.
 * The brief recommends; humans decide (division-design §4). The prompt
 * forbids invention: every claim must come from the provided data.
 */

export const briefSchema = z.object({
  recommandation: z.enum(['GO', 'NO_GO', 'GO_SOUS_CONDITIONS']),
  confiance: z.number().min(0).max(1),
  synthese: z.string().min(10),
  argumentsPour: z.array(z.string()),
  risques: z.array(z.string()),
  verifications: z.array(z.string()),
});
export type GoNoGoBrief = z.infer<typeof briefSchema>;

export const STRATEGIST_SYSTEM_PROMPT = `Tu es le Stratège de la Division Marchés d'AGHA RM INFRA (entreprise marocaine de BTP/hydraulique).
On te fournit les données structurées d'un appel d'offres public marocain (fiche, résultat de
qualification automatique, rétro-planning). Tu rédiges la note Go/No-Go pour la Direction.
RÈGLES ABSOLUES:
- Tu t'appuies UNIQUEMENT sur les données fournies. Tu n'inventes aucun fait, aucun chiffre.
- Ce qui est inconnu va dans "verifications" (à vérifier avant la décision), jamais dans la synthèse comme un fait.
- La décision finale appartient aux humains: tu recommandes, tu ne décides pas.
Tu réponds UNIQUEMENT avec un objet JSON valide:
{
  "recommandation": "GO" | "NO_GO" | "GO_SOUS_CONDITIONS",
  "confiance": nombre entre 0 et 1,
  "synthese": "3-5 phrases en français, denses et factuelles",
  "argumentsPour": ["..."],
  "risques": ["..."],
  "verifications": ["données manquantes à vérifier avant G1"]
}`;

export interface BriefOutcome {
  ok: boolean;
  brief?: GoNoGoBrief;
  issues?: string[];
  raw: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Serializes the decision dossier handed to the model. */
export function buildBriefPrompt(dossier: Record<string, unknown>): string {
  return `Données de l'appel d'offres (JSON):\n${JSON.stringify(dossier, null, 2)}\n\nProduis la note Go/No-Go.`;
}

export async function generateBrief(
  llm: LlmClient,
  dossier: Record<string, unknown>,
): Promise<BriefOutcome> {
  const completion = await llm.complete({
    tier: 'T3',
    system: STRATEGIST_SYSTEM_PROMPT,
    prompt: buildBriefPrompt(dossier),
    maxTokens: 1500,
    // Deep-reasoning models restructure free JSON — prefilling through the
    // first schema key leaves no room to invent an envelope.
    prefill: '{"recommandation": "',
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

  const validated = briefSchema.safeParse(parsed);
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
    brief: validated.data,
    raw: completion.text,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
