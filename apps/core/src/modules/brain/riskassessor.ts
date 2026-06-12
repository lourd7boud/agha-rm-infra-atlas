import { z } from 'zod';
import { parseModelJson } from './extractor';
import type { LlmClient } from './llm.client';

/**
 * Risk Assessor (agent C3) — structured risk analysis on the T2 model.
 * Feeds the G1/G2 reviewers: every risk names its category, severity,
 * probability and a concrete mitigation. No invention: risks must derive
 * from the provided dossier, unknowns become verification asks.
 */

export const riskAssessmentSchema = z.object({
  niveauGlobal: z.enum(['faible', 'moyen', 'eleve']),
  synthese: z.string().min(10),
  risques: z
    .array(
      z.object({
        categorie: z.enum([
          'technique',
          'financier',
          'administratif',
          'delai',
          'juridique',
          'environnemental',
        ]),
        description: z.string().min(10),
        gravite: z.enum(['faible', 'moyenne', 'elevee']),
        probabilite: z.enum(['faible', 'moyenne', 'elevee']),
        mitigation: z.string().min(5),
      }),
    )
    .min(3, 'au moins 3 risques attendus'),
});
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

export const RISK_ASSESSOR_SYSTEM_PROMPT = `Tu es l'Analyste Risques de la Division Marchés d'AGHA RM INFRA (entreprise marocaine de BTP/hydraulique).
On te fournit les données structurées d'un appel d'offres public marocain.
Tu produis l'analyse des risques du dossier pour les revues G1/G2.
RÈGLES ABSOLUES:
- Chaque risque découle des données fournies (objet, montants, délais, qualifications, planning). Tu n'inventes aucun fait.
- Catégories autorisées: technique, financier, administratif, delai, juridique, environnemental.
- Chaque risque porte une mitigation concrète et actionnable.
- Les inconnues importantes deviennent des risques administratifs avec mitigation = vérification à mener.
Tu réponds UNIQUEMENT avec un objet JSON valide:
{
  "niveauGlobal": "faible" | "moyen" | "eleve",
  "synthese": "2-4 phrases denses en français",
  "risques": [{ "categorie": "...", "description": "...", "gravite": "...", "probabilite": "...", "mitigation": "..." }]
}`;

export interface RiskOutcome {
  ok: boolean;
  assessment?: RiskAssessment;
  issues?: string[];
  raw: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Serializes the dossier handed to the model. */
export function buildRiskPrompt(dossier: Record<string, unknown>): string {
  return `Données de l'appel d'offres (JSON):\n${JSON.stringify(dossier, null, 2)}\n\nProduis l'analyse des risques.`;
}

export async function assessRisks(
  llm: LlmClient,
  dossier: Record<string, unknown>,
): Promise<RiskOutcome> {
  const completion = await llm.complete({
    tier: 'T2',
    system: RISK_ASSESSOR_SYSTEM_PROMPT,
    prompt: buildRiskPrompt(dossier),
    maxTokens: 2500,
    prefill: '{"niveauGlobal": "',
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

  const validated = riskAssessmentSchema.safeParse(parsed);
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
    assessment: validated.data,
    raw: completion.text,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
