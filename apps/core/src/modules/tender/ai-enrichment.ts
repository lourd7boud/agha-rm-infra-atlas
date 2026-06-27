import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { LlmClient } from '../brain/llm.client';
import { parseModelJson } from '../brain/extractor';

/**
 * AI enrichment of a tender — a fast LLM reads what we already know about an
 * appel d'offres and fills the structural/qualitative blanks the portal does
 * not give us directly: a fine secteur, a short résumé, a soumissionnaire FAQ,
 * the lot breakdown and the standard conditions. Financial figures are NEVER
 * invented (a hallucinated budget would mislead a real bid) — unknown numbers
 * stay null and real amounts keep coming from the portal detail crawl.
 */

export const aiEnrichmentSchema = z.object({
  secteur: z.string().trim().min(1).max(80),
  resume: z.string().trim().min(1).max(1200),
  faq: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        reponse: z.string().trim().min(1).max(800),
      }),
    )
    .max(6)
    .default([]),
  lots: z
    .array(
      z.object({
        designation: z.string().trim().min(1).max(200),
        description: z.string().trim().max(800).nullish(),
      }),
    )
    .max(30)
    .default([]),
  conditions: z
    .object({
      cautionDefinitivePct: z.number().min(0).max(100).nullish(),
      retenueGarantiePct: z.number().min(0).max(100).nullish(),
      delaiGarantieMois: z.number().int().min(0).max(120).nullish(),
    })
    .default({}),
  reserveAuxPme: z.boolean().default(false),
});

export type AiEnrichmentData = z.infer<typeof aiEnrichmentSchema>;

/**
 * Gemini controlled-generation schema mirroring aiEnrichmentSchema. Required
 * because the enrichment INPUT is a list of "Clé: valeur" lines, which Gemini
 * (native generateContent) otherwise echoes back as JSON instead of producing
 * {secteur, resume, …}. Only secteur/resume are required; the rest default. */
export const ENRICH_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    secteur: { type: 'string' },
    resume: { type: 'string' },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, reponse: { type: 'string' } },
        required: ['question', 'reponse'],
      },
    },
    lots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          designation: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
        required: ['designation'],
      },
    },
    conditions: {
      type: 'object',
      properties: {
        cautionDefinitivePct: { type: 'number', nullable: true },
        retenueGarantiePct: { type: 'number', nullable: true },
        delaiGarantieMois: { type: 'integer', nullable: true },
      },
    },
    reserveAuxPme: { type: 'boolean' },
  },
  required: ['secteur', 'resume'],
};

/** Stored envelope = validated data + provenance. */
export const storedAiEnrichmentSchema = aiEnrichmentSchema.extend({
  model: z.string(),
  enrichedAt: z.string(),
});
export type AiEnrichment = z.infer<typeof storedAiEnrichmentSchema>;

export const ENRICHMENT_SYSTEM_PROMPT = `Tu es analyste de marchés publics marocains (BTP, fournitures, services) pour AGHA RM INFRA.
On te donne les informations connues d'un appel d'offres public. Tu renvoies UNIQUEMENT un objet JSON valide, sans texte autour:
{
  "secteur": "secteur d'activité fin et précis en 2-4 mots (ex: 'Eau potable et assainissement', 'Génie civil', 'Bâtiment', 'Voirie et routes', 'Électrification', 'Forages et captage', 'Irrigation', 'Matériel informatique', 'Mobilier et fournitures de bureau', 'Santé et matériel médical', 'Études et ingénierie', 'Gardiennage et nettoyage', 'Transport')",
  "resume": "résumé clair en 2 à 3 phrases de l'objet et de l'enjeu du marché",
  "faq": [{"question": "...", "reponse": "..."}],
  "lots": [{"designation": "...", "description": "..."}],
  "conditions": {"cautionDefinitivePct": null, "retenueGarantiePct": null, "delaiGarantieMois": null},
  "reserveAuxPme": false
}
Règles STRICTES:
- "faq": 2 à 4 questions/réponses utiles à un soumissionnaire (qualification/classe exigée, délais, pièces, visite des lieux) UNIQUEMENT si déductibles du texte fourni, sinon [].
- "lots": la décomposition en lots si elle apparaît dans l'objet, sinon [].
- "reserveAuxPme": true UNIQUEMENT si le texte indique explicitement que le marché est réservé aux PME / TPE / auto-entrepreneurs / coopératives, sinon false.
- N'INVENTE JAMAIS de chiffre financier (budget, montant, caution) ni de pourcentage absent du texte: mets null.
- Si une information n'est pas déductible: null, [] ou false.
- Réponds en français. JSON pur uniquement.`;

export interface EnrichmentInput {
  objet: string;
  buyerName: string;
  procedureLabel: string;
  category: string;
  categorieDetail?: string | null;
  qualificationsRequises?: readonly string[] | null;
  cautionProvisoireMad?: number | null;
}

export function buildEnrichmentPrompt(input: EnrichmentInput): string {
  const lines = [
    `Acheteur: ${input.buyerName}`,
    `Procédure: ${input.procedureLabel}`,
    `Catégorie: ${input.category}`,
    `Objet: ${input.objet}`,
  ];
  if (input.categorieDetail) {
    lines.push(`Catégorie (portail): ${input.categorieDetail}`);
  }
  if (input.qualificationsRequises && input.qualificationsRequises.length > 0) {
    lines.push(`Qualifications exigées: ${input.qualificationsRequises.join(' ; ')}`);
  }
  if (input.cautionProvisoireMad != null) {
    lines.push(`Caution provisoire connue (DH): ${input.cautionProvisoireMad}`);
  }
  return lines.join('\n');
}

/** Calls the LLM and returns a validated enrichment. Throws on invalid output. */
export async function aiEnrich(
  llm: LlmClient,
  input: EnrichmentInput,
): Promise<AiEnrichment> {
  const completion = await llm.complete({
    tier: 'T1',
    system: ENRICHMENT_SYSTEM_PROMPT,
    prompt: buildEnrichmentPrompt(input),
    prefill: '{',
    maxTokens: 1200,
    responseSchema: ENRICH_RESPONSE_SCHEMA,
  });

  // Same defensive contract as the other brain agents: never surface a raw
  // ZodError (→ 500). Log the validation issues server-side, return a clean 503.
  let parsed: unknown;
  try {
    parsed = parseModelJson(completion.text, completion.prefill);
  } catch {
    throw new ServiceUnavailableException('Réponse IA non-JSON — réessayer');
  }
  const result = aiEnrichmentSchema.safeParse(parsed);
  if (!result.success) {
    new Logger('AiEnrichment').warn(
      `réponse IA invalide: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
    throw new ServiceUnavailableException('Réponse IA invalide — réessayer');
  }
  return {
    ...result.data,
    model: completion.model,
    enrichedAt: new Date().toISOString(),
  };
}

/** Reads a previously-stored enrichment from a tender's raw JSONB (defensive). */
export function readAiEnrichment(
  raw: Record<string, unknown> | null | undefined,
): AiEnrichment | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = (raw as Record<string, unknown>).aiEnrichment;
  if (!candidate) return null;
  const result = storedAiEnrichmentSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** Bounded-concurrency worker pool — keeps bulk enrichment fast but polite. */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const size = Math.max(1, Math.min(concurrency, queue.length));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
