import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import { parseModelJson } from '../brain/extractor';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from './tender.repository';
import {
  buildInventory,
  type InventoryFilters,
  type InventoryItem,
} from './inventory.domain';

/**
 * Assistant IA — datao's "Décrivez votre besoin" surface. Takes a natural-
 * language question and returns:
 *   • a structured `filters` object the web can apply on /tenders, AND
 *   • a narrative `answer` referencing real tender refs from our inventory.
 *
 * Strict groundings: the model is fed the catalogue's facet vocabulary
 * (procedures, categories, secteurs, regions, top buyers) so it picks valid
 * values; and a sample of matching tender refs+objets so the narrative is
 * citation-real, never fabricated.
 */

export interface AssistantReply {
  /** Filters the web can replay on /tenders to surface the matches. */
  filters: InventoryFilters;
  /** Free-form French narrative summary (markdown-flavored, plain text). */
  answer: string;
  /** Number of inventory rows the assistant's filters matched. */
  matchedCount: number;
  /** Top tender refs shown to the user as preview chips. */
  topRefs: Array<{ id: string; reference: string; buyerName: string; objet: string }>;
  /** Echo of the model used. */
  model: string;
}

const MAX_QUESTION_CHARS = 500;
const MAX_PREVIEW_ROWS = 25;
/** Cap the per-call sample size handed to the model — keeps the prompt bounded. */
const MAX_SAMPLE_ROWS = 80;

const SYSTEM_PROMPT = `Tu es un assistant de recherche pour le catalogue marocain de marchés publics ATLAS. À partir d'une demande en français (parfois en arabe), tu dois:
1) Choisir des filtres concrets (catégorie / secteur / région / acheteur / mots-clés / budget) parmi la liste FACET fournie. Ne devine pas de valeur hors liste.
2) Rédiger une réponse narrative en français, structurée, qui se base UNIQUEMENT sur les marchés trouvés (objet, acheteur, référence). Cite la référence entre [crochets] (ex: [AO 23/2026/DRETLH]).

Réponds UNIQUEMENT en JSON valide:
{
  "filters": {
    "procedures": ["..."],
    "categories": ["Travaux" | "Fournitures" | "Services"],
    "secteurs": ["..."],
    "regions": ["..."],
    "buyers": ["..."],
    "search": "mots-clés libres ou null",
    "lifecycle": "en_cours" | "cloture" | "attribue" | "infructueux" | null,
    "budgetOnly": boolean,
    "cautionOnly": boolean
  },
  "answer": "Texte narratif en français, paragraphes courts, références citées entre crochets."
}
Règles STRICTES:
- N'invente JAMAIS de référence: utilise seulement celles présentes dans l'échantillon.
- Si rien ne correspond, dis-le clairement et propose une variante de filtres.
- Pas de chiffres financiers fabriqués.`;

/** Tiny ad-hoc validator — avoids a new zod dependency just for two shapes. */
function parseAssistantOutput(raw: unknown): {
  filters: InventoryFilters;
  answer: string;
} {
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const r = raw as Record<string, unknown>;
  const a = r['answer'];
  if (typeof a !== 'string' || !a.trim()) throw new Error('answer missing');
  const f = (r['filters'] ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? (v as string[])
      : undefined;
  const filters: InventoryFilters = {};
  // We only model single-valued filters in InventoryFilters today, so pick the
  // first value of each multi-select the model returned (the web inflates it
  // back to the array when it replays the filters from the saved-search payload).
  const ps = arr(f['procedures']);
  if (ps?.[0]) (filters as Record<string, unknown>).procedure = ps[0];
  const rs = arr(f['regions']);
  if (rs?.[0]) filters.region = rs[0];
  const bs = arr(f['buyers']);
  if (bs?.[0]) filters.buyer = bs[0];
  if (typeof f['search'] === 'string') filters.q = f['search'] as string;
  if (typeof f['lifecycle'] === 'string') {
    const lc = f['lifecycle'] as string;
    if (['en_cours', 'cloture', 'attribue', 'infructueux'].includes(lc)) {
      filters.lifecycle = lc as InventoryFilters['lifecycle'];
    }
  }
  return { filters, answer: a.trim() };
}

@Injectable()
export class TenderAssistantService {
  private readonly logger = new Logger('TenderAssistant');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  async ask(question: string): Promise<AssistantReply> {
    if (!this.llm) {
      throw new ServiceUnavailableException('LLM non configuré (clé manquante)');
    }
    const q = question.trim();
    if (!q) throw new BadRequestException('Question vide');
    if (q.length > MAX_QUESTION_CHARS) {
      throw new BadRequestException(
        `Question trop longue (max ${MAX_QUESTION_CHARS} caractères)`,
      );
    }

    // Build the catalogue once + extract facet vocabulary + a small relevant
    // sample (keyword-overlap) to ground the model.
    const now = new Date();
    const [records, bids] = await Promise.all([
      this.tenders.findAll(),
      this.intel.listAllBids(),
    ]);
    const inv = buildInventory(records, {}, now, { limit: 1000 }, bids);
    const facetText = [
      `Catégories: ${inv.facets.categories.map((f) => f.label).join(', ')}`,
      `Procédures: ${inv.facets.procedures
        .map((f) => `${f.key}=${f.label}`)
        .join('; ')}`,
      `Régions: ${inv.facets.regions
        .slice(0, 20)
        .map((f) => f.label)
        .join(', ')}`,
      `Secteurs (top 30): ${inv.facets.secteurs
        .slice(0, 30)
        .map((f) => f.label)
        .join(', ')}`,
      `Top acheteurs: ${inv.facets.buyers
        .slice(0, 30)
        .map((f) => f.label)
        .join(', ')}`,
    ].join('\n');

    // Tiny keyword sample to ground the narrative — without it the model has no
    // real refs to cite. Falls back to the first 20 active items if no keyword
    // matched (e.g. user asked "quels marchés ouverts ?" with no specifics).
    const needle = q.toLowerCase();
    const tokens = needle
      .split(/[\s,.;:!?]+/u)
      .filter((t) => t.length >= 3)
      .slice(0, 8);
    const scored = inv.items
      .map((it) => {
        const hay = `${it.reference} ${it.objet} ${it.buyerName} ${it.region} ${it.location ?? ''} ${it.secteur}`.toLowerCase();
        const hits = tokens.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
        return { it, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, MAX_SAMPLE_ROWS);
    const sample = scored.length > 0 ? scored : inv.items.slice(0, 20).map((it) => ({ it, hits: 0 }));
    const sampleText = sample
      .map(
        ({ it }) =>
          `- [${it.reference}] ${it.buyerName} — ${it.objet.slice(0, 140)} (${it.region}${it.location ? ', ' + it.location : ''})`,
      )
      .join('\n');

    const prompt = `=== FACETS DISPONIBLES ===\n${facetText}\n\n=== ÉCHANTILLON (${sample.length} marchés${tokens.length ? ' correspondant à des mots-clés' : ' — premiers actifs faute de mots-clés'}) ===\n${sampleText}\n\n=== DEMANDE UTILISATEUR ===\n${q}\n\nRéponds en JSON.`;

    const completion = await this.llm.complete({
      tier: 'T1',
      system: SYSTEM_PROMPT,
      prompt,
      prefill: '{',
      maxTokens: 1500,
    });

    let parsed: unknown;
    try {
      parsed = parseModelJson(completion.text, completion.prefill);
    } catch {
      throw new ServiceUnavailableException('Réponse IA non-JSON — réessayer');
    }
    let out: { filters: InventoryFilters; answer: string };
    try {
      out = parseAssistantOutput(parsed);
    } catch (e) {
      this.logger.warn(`assistant invalide: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Réponse IA invalide — réessayer');
    }

    // Re-run the inventory with the produced filters so the UI sees the exact
    // count and can show a preview without a second round-trip.
    const filteredInv = buildInventory(records, out.filters, now, { limit: 1000 }, bids);
    const matchedCount = filteredInv.filteredCount;
    const topRefs = filteredInv.items
      .slice(0, MAX_PREVIEW_ROWS)
      .map((it: InventoryItem) => ({
        id: it.id,
        reference: it.reference,
        buyerName: it.buyerName,
        objet: it.objet,
      }));

    this.logger.log(
      `assistant q="${q.slice(0, 80)}" → ${matchedCount} matches, ${out.answer.length}ch`,
    );
    return {
      filters: out.filters,
      answer: out.answer,
      matchedCount,
      topRefs,
      model: completion.model,
    };
  }
}
