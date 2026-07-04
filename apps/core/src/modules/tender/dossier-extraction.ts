import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { LlmClient, LlmVisionDocImage } from '../brain/llm.client';
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

/** Truncating string field: NEVER rejects on length. A zod `.max()` on a string
 *  is a validation ERROR, so a single over-long value (e.g. a long legal-article
 *  citation the model emits) would fail the WHOLE parse and discard the budget,
 *  caution and everything else — the same trap the arrays warn about. We trim +
 *  slice to a bound instead, so over-length never costs us the extraction. */
const boundedStr = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const boundedStrNullish = (max: number) => boundedStr(max).nullish();

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
        secteur: boundedStrNullish(120),
        qualification: boundedStrNullish(120),
        classe: boundedStrNullish(40),
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
        /** Section/série/corps-d'état/lot header this line falls under (datao
         *  groups the BPU by these, e.g. "A-RESERVOIRES", "PORT DE LAAYOUNE"). */
        section: boundedStrNullish(160),
        designation: boundedStr(300),
        quantite: z.number().nullish(),
        unite: boundedStrNullish(24),
        prixUnitaireMad: moneyMad,
      }),
    )
    .default([]),
  /** Contact du maître d'ouvrage (du RC/avis): nom, email, téléphone. */
  contact: z
    .object({
      nom: boundedStrNullish(160),
      email: boundedStrNullish(160),
      telephone: boundedStrNullish(60),
    })
    .nullish(),
  /** Références réglementaires citées (décrets, CCAG, textes de loi). */
  conditionsLegales: z.array(boundedStr(240)).default([]),
  /** Autres conditions notables (dépôt électronique, variantes, délais clés…). */
  autres: z.array(boundedStr(240)).default([]),
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

/**
 * Portal-first precedence for the estimation/caution COLUMNS. The consultation
 * detail page (harvested by the watch detail crawler into raw.detail + the
 * columns) is the authoritative published source, so the DCE/LLM only fills a
 * money column the portal left empty — it never overwrites a value already on
 * the row. This is the "l'agent n'intervient que là où le portail n'a rien"
 * rule: the LLM stays the source of truth for the fields the portal does NOT
 * publish (BPU line items, percentages, délais, chiffre d'affaires…), but for
 * the two figures the portal DOES publish it defers to the portal.
 */
export function resolvePortalFirstAmounts(
  current: {
    estimationMad?: number | null;
    cautionProvisoireMad?: number | null;
  },
  extraction: {
    estimationMad?: number | null;
    cautionProvisoireMad?: number | null;
  },
): { estimationMad?: number; cautionProvisoireMad?: number } {
  const amounts: { estimationMad?: number; cautionProvisoireMad?: number } = {};
  if (current.estimationMad == null && typeof extraction.estimationMad === 'number') {
    amounts.estimationMad = extraction.estimationMad;
  }
  if (
    current.cautionProvisoireMad == null &&
    typeof extraction.cautionProvisoireMad === 'number'
  ) {
    amounts.cautionProvisoireMad = extraction.cautionProvisoireMad;
  }
  return amounts;
}

export type DossierExtractionData = z.infer<typeof dossierExtractionSchema>;

/** Stored envelope = validated data + provenance. */
export const storedDossierExtractionSchema = dossierExtractionSchema.extend({
  model: z.string(),
  extractedAt: z.string(),
  sourceFiles: z.array(z.string()).default([]),
});
export type DossierExtraction = z.infer<typeof storedDossierExtractionSchema>;

/**
 * Gemini controlled-generation schema mirroring dossierExtractionSchema. WITHOUT
 * it, native Gemini freelances its own JSON shape (English keys like
 * `contracting_authority`, `scope_of_work`, …) which — because every field here
 * is nullish/defaulted — silently passes safeParse as an ALL-EMPTY extraction.
 * The schema forces the exact keys so budget/caution/BPU/qualifications actually
 * land. All fields optional (only bpu.designation required) so a genuinely absent
 * value stays null rather than being hallucinated to satisfy the schema. */
const num = { type: 'number', nullable: true } as const;
const str = { type: 'string', nullable: true } as const;
export const DOSSIER_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    estimationMad: num,
    cautionProvisoireMad: num,
    cautionDefinitivePct: num,
    retenueGarantiePct: num,
    delaiGarantieMois: { type: 'integer', nullable: true },
    delaiExecutionMois: num,
    chiffreAffairesMinMad: num,
    qualifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: { secteur: str, qualification: str, classe: str },
      },
    },
    bpu: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: str,
          designation: { type: 'string' },
          quantite: num,
          unite: str,
          prixUnitaireMad: num,
        },
        required: ['designation'],
      },
    },
    contact: {
      type: 'object',
      nullable: true,
      properties: { nom: str, email: str, telephone: str },
    },
    conditionsLegales: { type: 'array', items: { type: 'string' } },
    autres: { type: 'array', items: { type: 'string' } },
  },
};

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
  "bpu": [{"section": "...", "designation": "...", "quantite": null, "unite": "...", "prixUnitaireMad": null}],
  "contact": {"nom": null, "email": null, "telephone": null},
  "conditionsLegales": ["..."],
  "autres": ["..."]
}
Règles STRICTES:
- Tous les montants en dirhams (DH/MAD) comme NOMBRES sans séparateur ni devise: "Trois cent soixante-dix-neuf mille cent quatre dirhams (379 104,00 Dhs)" -> 379104. "Sept Mille (7 000,00) dirhams" -> 7000.
- "estimationMad" — montant total estimatif du marché en DH. RECHERCHE OBLIGATOIRE dans cet ordre, ne mets null QUE si réellement absent des 5 sources suivantes:
  (1) Avis (champ « Estimation des coûts », « Budget prévisionnel », « Montant prévisionnel »),
  (2) RC (article ou paragraphe « Estimation », « Budget », « Enveloppe budgétaire »),
  (3) BPDE / Bordereau des prix / Détail estimatif: DERNIÈRE ligne du tableau, libellés « Montant estimatif total », « TOTAL HT », « Total estimatif », « Total Général » — c'est LA source pour les marchés-cadres (SRM, ONEE-Branche-Eau, RADEEMA, etc.) où l'estimation n'est ni dans l'avis ni dans le RC,
  (4) CPS (rare): article « Montant prévisionnel du marché »,
  (5) toute mention isolée « X DH HT » au pied d'un tableau ou dans un récapitulatif.
- "cautionProvisoireMad" — montant du cautionnement provisoire. RECHERCHE OBLIGATOIRE: avis d'appel d'offres (champ « Cautionnement provisoire » / « Caution provisoire ») ou RC (article « Cautionnement provisoire »). Si le texte écrit explicitement « Sans caution provisoire » / « Caution non exigée » -> null. Sinon ne renvoie null QUE si réellement absent.
- "cautionDefinitivePct"/"retenueGarantiePct": en POURCENTAGE (3 -> 3). "delaiGarantieMois"/"delaiExecutionMois": en MOIS (convertis les jours: 90 jours -> 3).
- "chiffreAffairesMinMad": chiffre d'affaires annuel minimum exigé en DH, sinon null.
- "qualifications": chaque (secteur/activité, qualification, classe) exigé. Aucune exigée: [].
- "bpu": les postes du bordereau des prix / détail estimatif visibles dans le texte (désignation + quantité + unité + prix unitaire si présent). Si non visible: [].
- "bpu[].section": le titre de la SECTION/série/corps d'état/sous-tête sous laquelle figure le poste (ex: "A-RESERVOIRES de 100m3", "B-PUIT ET SON EQUIPEMENT", "PORT DE LAAYOUNE", "Série 1 : ..."). Reporte le MÊME libellé de section pour tous les postes qui en relèvent. Aucune section: null.
- "contact": le contact du maître d'ouvrage indiqué dans le RC/avis (personne à contacter, e-mail, téléphone). Champs absents = null.
- "conditionsLegales": les références réglementaires CITÉES dans le dossier (ex: "Décret n° 2-22-431 du 8 mars 2023 relatif aux marchés publics", "CCAG-T approuvé par décret n° 2-14-394"). Chaque texte une chaîne. Aucune citée: [].
- "autres": 2 à 5 conditions notables NON déjà couvertes ci-dessus, en phrases courtes (ex: "Dépôt électronique obligatoire", "Variantes non autorisées", "Visite des lieux obligatoire", "Échantillons exigés", "Livraison sous 30 jours"). Rien de notable: [].
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
    // 8 000 tokens of headroom — the previous 3 000 truncated BPU on rich
    // dossiers (a real BTP estimatif can carry 50+ line items). 8 000 covers
    // ~200 items comfortably without inflating cost for the small ones.
    maxTokens: 8000,
    // Forces native Gemini onto the exact schema — without it Gemini invents its
    // own JSON keys and the extraction silently parses as all-empty.
    responseSchema: DOSSIER_RESPONSE_SCHEMA,
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
  return finalizeDossier(result.data, dossierText, completion.model, sourceFiles, false);
}

/** Caps for the conditionsLegales/autres lists (truncation, never rejection). */
const MAX_LEGALES = 12;
const MAX_AUTRES = 12;

/**
 * Shared post-parse finalisation for both the text and vision extraction paths.
 * Headline money is trusted only when corroborated by `corroborationText` AND
 * within a plausible band — EXCEPT in `trustModelNumbers` mode (the vision path
 * on a pure scan, where there is no OCR text to match against): there the model
 * read the printed figure directly off the image, so we keep it on the
 * plausibility floor alone. Over-long lists are truncated, never rejected.
 */
function finalizeDossier(
  data: DossierExtractionData,
  corroborationText: string,
  model: string,
  sourceFiles: readonly string[],
  trustModelNumbers: boolean,
): DossierExtraction {
  const textDigits = digitsOnly(corroborationText);
  const money = (value: number | null | undefined, min: number): number | null => {
    // Vision path: the model read the figure straight off the page IMAGES, so we
    // trust it on the plausibility floor alone. We must NOT corroborate against
    // `corroborationText` here — on a hybrid dossier that text is only the
    // DIGITAL pieces (e.g. the BPU), so a real estimation read from a SCANNED RC
    // image would be wrongly nulled because its digits aren't in the text layer.
    if (trustModelNumbers) {
      return typeof value === 'number' && Number.isFinite(value) && value >= min
        ? value
        : null;
    }
    return corroborateMoney(value, textDigits, min);
  };
  return {
    ...data,
    estimationMad: money(data.estimationMad, MIN_ESTIMATION_MAD),
    cautionProvisoireMad: money(data.cautionProvisoireMad, MIN_CAUTION_MAD),
    chiffreAffairesMinMad: money(data.chiffreAffairesMinMad, MIN_ESTIMATION_MAD),
    // Drop rows/entries emptied by truncation, then bound the list lengths.
    bpu: data.bpu.filter((b) => b.designation.length > 0).slice(0, MAX_BPU),
    qualifications: data.qualifications
      .filter((q) => q.secteur || q.qualification || q.classe)
      .slice(0, MAX_QUALIFICATIONS),
    conditionsLegales: data.conditionsLegales.filter((s) => s.length >= 3).slice(0, MAX_LEGALES),
    autres: data.autres.filter((s) => s.length >= 3).slice(0, MAX_AUTRES),
    model,
    extractedAt: new Date().toISOString(),
    sourceFiles: [...sourceFiles],
  };
}

/** Builds the user message for the VISION extraction call: the model is handed
 *  the scanned page IMAGES separately; this text frames the task + supplies any
 *  digital text-layer content found in the same dossier (hybrid DCEs). */
export function buildVisionExtractionPrompt(
  digitalText: string,
  context?: { reference?: string; objet?: string },
): string {
  const header: string[] = [];
  if (context?.reference) header.push(`Référence: ${context.reference}`);
  if (context?.objet) header.push(`Objet: ${context.objet}`);
  const parts = [
    header.join('\n'),
    'Les pages du dossier de consultation (DCE) sont fournies en IMAGES ci-jointes. ' +
      "Lis-les attentivement (français + arabe), y compris les tableaux (bordereau des prix), et renvoie l'objet JSON demandé.",
  ];
  if (digitalText.trim()) {
    parts.push(`=== TEXTE ADDITIONNEL (couche texte d'autres pièces) ===\n${digitalText}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * VISION extraction — the datao-grade fast path for SCANNED dossiers. Instead of
 * tesseract→text→LLM (CPU-bound, lossy on tables/Arabic), the page images are
 * sent straight to the multimodal model, which does OCR + layout understanding +
 * extraction in ONE call. Same schema + finalisation as the text path; money is
 * trusted on the plausibility floor when there is no text layer to corroborate.
 */
export async function aiExtractDossierVision(
  llm: LlmClient,
  images: readonly LlmVisionDocImage[],
  digitalText: string,
  sourceFiles: readonly string[],
  context?: { reference?: string; objet?: string },
): Promise<DossierExtraction> {
  if (images.length === 0) {
    throw new ServiceUnavailableException('Aucune page à analyser (rendu vide)');
  }
  const completion = await llm.completeVisionDoc({
    tier: 'T1',
    system: DOSSIER_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildVisionExtractionPrompt(digitalText, context),
    images: [...images],
    maxTokens: 8000,
    jsonMode: true,
    // Same controlled-generation guard as the text path (see DOSSIER_RESPONSE_SCHEMA).
    responseSchema: DOSSIER_RESPONSE_SCHEMA,
  });
  let parsed: unknown;
  try {
    parsed = parseModelJson(completion.text);
  } catch {
    throw new ServiceUnavailableException('Réponse IA non-JSON — réessayer');
  }
  const result = dossierExtractionSchema.safeParse(parsed);
  if (!result.success) {
    new Logger('DossierExtraction').warn(
      `extraction vision invalide: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
    throw new ServiceUnavailableException('Extraction IA invalide — réessayer');
  }
  return finalizeDossier(result.data, digitalText, completion.model, sourceFiles, true);
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
