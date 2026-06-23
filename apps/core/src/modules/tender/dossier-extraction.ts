import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { LlmClient } from '../brain/llm.client';
import { parseModelJson } from '../brain/extractor';

/**
 * AI extraction over the REAL dossier (DCE) text — the datao-grade layer. Where
 * ai-enrichment.ts only sees the listing line, this reads the RC/CPS/BPU text
 * (see dossier-text.ts) and pulls the hard facts the portal hides: the maître
 * d'ouvrage's cost estimate (budget), the cautions, the required qualifications
 * and the BPU line items. Every figure must be quoted from the text — anything
 * absent stays null, never guessed (a fake budget would wreck a real bid).
 */

const moneyMad = z.number().min(0).max(100_000_000_000).nullish();
const pct = z.number().min(0).max(100).nullish();

export const dossierExtractionSchema = z.object({
  /** Estimation des coûts établie par le maître d'ouvrage (DH TTC). */
  estimationMad: moneyMad,
  /** Cautionnement provisoire (DH). */
  cautionProvisoireMad: moneyMad,
  cautionDefinitivePct: pct,
  retenueGarantiePct: pct,
  delaiGarantieMois: z.number().int().min(0).max(120).nullish(),
  /** Délai d'exécution global (en mois; convertir jours→mois si besoin). */
  delaiExecutionMois: z.number().min(0).max(120).nullish(),
  /** Chiffre d'affaires annuel minimum exigé (DH), si stipulé. */
  chiffreAffairesMinMad: moneyMad,
  /** Qualifications/agréments exigés (secteur · qualification · classe). */
  qualifications: z
    .array(
      z.object({
        secteur: z.string().trim().max(120).nullish(),
        qualification: z.string().trim().max(120).nullish(),
        classe: z.string().trim().max(40).nullish(),
      }),
    )
    // No .max() here: a hard cap would REJECT the whole extraction (zod array
    // .max is a validation error, not a truncation), discarding the budget,
    // caution and everything else. We slice to a sane bound post-parse instead.
    .default([]),
  /** Bordereau des prix / détail estimatif line items, when present. */
  bpu: z
    .array(
      z.object({
        designation: z.string().trim().min(1).max(300),
        quantite: z.number().nullish(),
        unite: z.string().trim().max(24).nullish(),
        prixUnitaireMad: moneyMad,
      }),
    )
    .default([]),
});

/** Post-parse element caps (cost/payload bound; truncation, never rejection). */
const MAX_BPU = 300;
const MAX_QUALIFICATIONS = 60;
/** Plausibility floors — below these a "budget"/"caution" is almost certainly a
 *  year, an article/phone number or a misread, not a real MAD figure. */
const MIN_ESTIMATION_MAD = 1000;
const MIN_CAUTION_MAD = 100;

/** Digits only, so a figure can be matched against the text regardless of the
 *  Moroccan "1 234 567,89" thousands/decimal formatting. */
function digitsOnly(text: string): string {
  return text.replace(/\D+/g, '');
}

/**
 * Promotes an LLM money figure to a TRUSTED value only when it is plausible AND
 * its integer digits actually appear in the dossier text — the code-level
 * backstop to the prompt's "n'invente rien". A hallucinated or out-of-band
 * number degrades to null (kept out of the persisted column) rather than being
 * presented as DCE-verified. 0 means "sans" → null.
 */
export function corroborateMoney(
  value: number | null | undefined,
  textDigits: string,
  min: number,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    return null;
  }
  return textDigits.includes(String(Math.round(value))) ? value : null;
}

export type DossierExtractionData = z.infer<typeof dossierExtractionSchema>;

/** Stored envelope = validated data + provenance. */
export const storedDossierExtractionSchema = dossierExtractionSchema.extend({
  model: z.string(),
  extractedAt: z.string(),
  sourceFiles: z.array(z.string()).default([]),
});
export type DossierExtraction = z.infer<typeof storedDossierExtractionSchema>;

export const DOSSIER_EXTRACTION_SYSTEM_PROMPT = `Tu es analyste de marchés publics marocains pour AGHA RM INFRA. On te donne le TEXTE BRUT du dossier de consultation (DCE: Règlement de Consultation, CPS, avis, bordereau des prix). Tu renvoies UNIQUEMENT un objet JSON valide, sans texte autour:
{
  "estimationMad": null,
  "cautionProvisoireMad": null,
  "cautionDefinitivePct": null,
  "retenueGarantiePct": null,
  "delaiGarantieMois": null,
  "delaiExecutionMois": null,
  "chiffreAffairesMinMad": null,
  "qualifications": [{"secteur": "...", "qualification": "...", "classe": "..."}],
  "bpu": [{"designation": "...", "quantite": null, "unite": "...", "prixUnitaireMad": null}]
}
Règles STRICTES:
- Tous les montants en dirhams (DH/MAD) comme NOMBRES sans séparateur ni devise: "Trois cent soixante-dix-neuf mille cent quatre dirhams (379 104,00 Dhs)" -> 379104. "Sept Mille (7 000,00) dirhams" -> 7000.
- "estimationMad": l'estimation des coûts établie par le maître d'ouvrage / le montant de l'estimation. Si absente: null.
- "cautionProvisoireMad": le montant du cautionnement provisoire. Si "sans caution" ou absent: null.
- "cautionDefinitivePct"/"retenueGarantiePct": en POURCENTAGE (3 -> 3). "delaiGarantieMois"/"delaiExecutionMois": en MOIS (convertis les jours: 90 jours -> 3).
- "chiffreAffairesMinMad": chiffre d'affaires annuel minimum exigé en DH, sinon null.
- "qualifications": chaque (secteur/activité, qualification, classe) exigé. Aucune exigée: [].
- "bpu": les postes du bordereau des prix / détail estimatif visibles dans le texte (désignation + quantité + unité + prix unitaire si présent). Si non visible: [].
- N'INVENTE RIEN. Ce qui n'est pas EXPLICITEMENT dans le texte = null / [].
- Réponds en français. JSON pur uniquement.`;

export function buildDossierExtractionPrompt(
  dossierText: string,
  context?: { reference?: string; objet?: string },
): string {
  const header: string[] = [];
  if (context?.reference) header.push(`Référence: ${context.reference}`);
  if (context?.objet) header.push(`Objet: ${context.objet}`);
  return `${header.join('\n')}\n\n=== TEXTE DU DOSSIER ===\n${dossierText}`;
}

/** Calls the LLM over the dossier text → validated extraction. Throws on bad output. */
export async function aiExtractDossier(
  llm: LlmClient,
  dossierText: string,
  sourceFiles: readonly string[],
  context?: { reference?: string; objet?: string },
): Promise<DossierExtraction> {
  const completion = await llm.complete({
    tier: 'T1',
    system: DOSSIER_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildDossierExtractionPrompt(dossierText, context),
    prefill: '{',
    maxTokens: 3000,
  });

  let parsed: unknown;
  try {
    parsed = parseModelJson(completion.text, completion.prefill);
  } catch {
    throw new ServiceUnavailableException('Réponse IA non-JSON — réessayer');
  }
  const result = dossierExtractionSchema.safeParse(parsed);
  if (!result.success) {
    new Logger('DossierExtraction').warn(
      `extraction IA invalide: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
    throw new ServiceUnavailableException('Extraction IA invalide — réessayer');
  }
  const data = result.data;
  const textDigits = digitsOnly(dossierText);
  return {
    ...data,
    // Headline money is trusted only when corroborated by the dossier text and
    // within a plausible band — else null (kept off the persisted columns).
    estimationMad: corroborateMoney(data.estimationMad, textDigits, MIN_ESTIMATION_MAD),
    cautionProvisoireMad: corroborateMoney(
      data.cautionProvisoireMad,
      textDigits,
      MIN_CAUTION_MAD,
    ),
    chiffreAffairesMinMad: corroborateMoney(
      data.chiffreAffairesMinMad,
      textDigits,
      MIN_ESTIMATION_MAD,
    ),
    // Truncate (never reject) over-long lists so the scalar facts always survive.
    bpu: data.bpu.slice(0, MAX_BPU),
    qualifications: data.qualifications.slice(0, MAX_QUALIFICATIONS),
    model: completion.model,
    extractedAt: new Date().toISOString(),
    sourceFiles: [...sourceFiles],
  };
}

/** Reads a previously-stored dossier extraction from a tender's raw JSONB. */
export function readDossierExtraction(
  raw: Record<string, unknown> | null | undefined,
): DossierExtraction | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = (raw as Record<string, unknown>).dossierExtraction;
  if (!candidate) return null;
  const result = storedDossierExtractionSchema.safeParse(candidate);
  return result.success ? result.data : null;
}
