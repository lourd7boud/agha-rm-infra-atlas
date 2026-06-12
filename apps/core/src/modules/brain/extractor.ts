import { z } from 'zod';
import type { LlmClient } from './llm.client';

/**
 * Extractor (agent A2) — turns avis/DCE text into structured tender fields.
 * Reading factory pattern (ai-architecture §3): extract → verify (Zod) →
 * caller persists; schema-invalid output is flagged, never silently used.
 */

export const avisExtractionSchema = z.object({
  reference: z.string().min(1).nullish(),
  buyerName: z.string().min(1).nullish(),
  procedure: z.string().min(1).nullish(),
  objet: z.string().min(1).nullish(),
  estimationMad: z.number().nonnegative().nullish(),
  cautionProvisoireMad: z.number().nonnegative().nullish(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/, 'ISO 8601 attendu')
    .nullish(),
  visiteDesLieux: z.string().nullish(),
  qualificationsRequises: z.array(z.string()).nullish(),
});
export type AvisExtraction = z.infer<typeof avisExtractionSchema>;

export const EXTRACTOR_SYSTEM_PROMPT = `Tu es l'Extracteur de la Division Marchés d'AGHA RM INFRA (BTP, Maroc).
On te donne le texte d'un avis d'appel d'offres public marocain ou d'un extrait de DCE.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, avec ces clés
(null quand l'information est absente du texte) :
{
  "reference": "référence de l'AO telle que publiée",
  "buyerName": "acheteur public (maître d'ouvrage)",
  "procedure": "appel d'offres ouvert | restreint | concours | négocié | bons de commande",
  "objet": "objet du marché",
  "estimationMad": nombre en dirhams (estimation du maître d'ouvrage),
  "cautionProvisoireMad": nombre en dirhams,
  "deadline": "date limite de remise des plis au format ISO 8601 (YYYY-MM-DDTHH:mm)",
  "visiteDesLieux": "date/description de la visite des lieux si exigée",
  "qualificationsRequises": ["secteur/qualification/classe exigés"]
}
Règles: les montants marocains s'écrivent 1.234.567,89 DH — convertis en nombre.
N'invente JAMAIS une valeur absente: utilise null.`;

export interface ExtractionOutcome {
  ok: boolean;
  data?: AvisExtraction;
  issues?: string[];
  raw: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Tolerates fenced output (```json … ```) which models sometimes emit. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const embedded = extractFirstJsonObject(candidate);
    if (embedded !== null) return JSON.parse(embedded);
    throw error;
  }
}

/**
 * Parses model output that may or may not include the request prefill:
 * providers that ignore prefill return complete JSON (parse text alone);
 * providers that honor it return a continuation (parse prefill + text).
 */
export function parseModelJson(text: string, prefill?: string): unknown {
  try {
    return parseJsonLoose(text);
  } catch (error) {
    if (prefill) return parseJsonLoose(prefill + text);
    throw error;
  }
}

/** Balanced-brace scan: recovers the first JSON object embedded in prose. */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export async function extractAvis(
  llm: LlmClient,
  text: string,
): Promise<ExtractionOutcome> {
  const completion = await llm.complete({
    tier: 'T1',
    system: EXTRACTOR_SYSTEM_PROMPT,
    prompt: text,
    maxTokens: 1024,
  });

  let parsed: unknown;
  try {
    parsed = parseJsonLoose(completion.text);
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

  const validated = avisExtractionSchema.safeParse(parsed);
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
    data: validated.data,
    raw: completion.text,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
