import { z } from 'zod';
import { parseModelJson } from './extractor';
import type { LlmClient } from './llm.client';

/**
 * Estimator (agent B3) — détail estimatif SKELETON on the T2 model.
 * v1 is structure-only by design: the schema has no price and no quantity
 * field, because real numbers come from the DCE's bordereau des prix and
 * the company's cost library — never from a language model. The skeleton
 * gives the estimating engineer a complete checklist of postes to price.
 */

export const estimateSkeletonSchema = z.object({
  titre: z.string().min(5),
  postes: z
    .array(
      z.object({
        designation: z.string().min(5),
        /** m3, ml, m2, kg, u, forfait… */
        unite: z.string().min(1),
        commentaire: z.string(),
      }),
    )
    .min(5, 'au moins 5 postes attendus'),
  hypotheses: z.array(z.string()),
  pointsAVerifier: z.array(z.string()),
});
export type EstimateSkeleton = z.infer<typeof estimateSkeletonSchema>;

export const ESTIMATOR_SYSTEM_PROMPT = `Tu es le Métreur-Estimateur de la Division Marchés d'AGHA RM INFRA (entreprise marocaine de BTP/hydraulique).
On te fournit les données structurées d'un appel d'offres public marocain.
Tu produis le SQUELETTE du détail estimatif: la liste des postes de travaux probables pour ce type d'ouvrage.
RÈGLES ABSOLUES:
- AUCUN prix, AUCUNE quantité: les chiffres viennent du bordereau des prix du DCE et des métrés réels, jamais de toi.
- Chaque poste: désignation précise (vocabulaire BTP marocain), unité de mesure usuelle, commentaire (hypothèse ou [À COMPLÉTER: …]).
- Les postes découlent de l'objet du marché fourni. Structure type: installation de chantier, terrassements, fondations, ouvrage principal, équipements, finitions, repli.
- Les incertitudes vont dans hypotheses et pointsAVerifier.
Tu réponds UNIQUEMENT avec un objet JSON valide:
{
  "titre": "Détail estimatif — <référence>",
  "postes": [{ "designation": "...", "unite": "...", "commentaire": "..." }],
  "hypotheses": ["..."],
  "pointsAVerifier": ["..."]
}`;

export interface EstimateOutcome {
  ok: boolean;
  skeleton?: EstimateSkeleton;
  issues?: string[];
  raw: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Serializes the dossier handed to the model. */
export function buildEstimatePrompt(dossier: Record<string, unknown>): string {
  return `Données de l'appel d'offres (JSON):\n${JSON.stringify(dossier, null, 2)}\n\nProduis le squelette du détail estimatif.`;
}

export async function generateEstimateSkeleton(
  llm: LlmClient,
  dossier: Record<string, unknown>,
): Promise<EstimateOutcome> {
  const completion = await llm.complete({
    tier: 'T2',
    system: ESTIMATOR_SYSTEM_PROMPT,
    prompt: buildEstimatePrompt(dossier),
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

  const validated = estimateSkeletonSchema.safeParse(parsed);
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
    skeleton: validated.data,
    raw: completion.text,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
