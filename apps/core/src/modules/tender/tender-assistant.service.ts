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
import { TtlCache } from '../../lib/ttl-cache';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
  type CompetitorBidRecord,
} from '../intel/intel.repository';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from './tender.repository';
import {
  buildInventory,
  type InventoryFilters,
  type InventoryItem,
  type InventoryRow,
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

/**
 * Gemini controlled-generation schema — forces the model to emit EXACTLY the
 * {filters, answer} shape. Without it, gemini-2.5-flash IGNORES the prompt's JSON
 * spec and hallucinates its own shape ({query, contracts:[…fabricated ids…]}),
 * which fails the parser → "Réponse IA non-JSON / invalide". The Anthropic and
 * OpenRouter clients ignore responseSchema and keep steering via the '{' prefill,
 * so this is safe across providers. (Verified against the live gemini-2.5-flash:
 * prompt-only JSON → wrong shape; schema → exact {filters, answer}.)
 */
const ASSISTANT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    filters: {
      type: 'object',
      properties: {
        procedures: { type: 'array', items: { type: 'string' } },
        categories: { type: 'array', items: { type: 'string' } },
        secteurs: { type: 'array', items: { type: 'string' } },
        regions: { type: 'array', items: { type: 'string' } },
        buyers: { type: 'array', items: { type: 'string' } },
        search: { type: 'string' },
        lifecycle: {
          type: 'string',
          enum: ['en_cours', 'cloture', 'attribue', 'infructueux'],
        },
        budgetOnly: { type: 'boolean' },
        cautionOnly: { type: 'boolean' },
      },
    },
    answer: { type: 'string' },
  },
  required: ['answer', 'filters'],
  propertyOrdering: ['filters', 'answer'],
};

/**
 * Filter-independent catalogue snapshot every question is grounded on. Cached for
 * a short window (CATALOGUE_CACHE_TTL_MS) so the two whole-catalogue reads
 * (findAllInventoryRows over ~97k rows + listResultMarkets over ~585k bids) and
 * the facet fold run ONCE per window instead of on every question — that whole-
 * catalogue scan was the bulk of the non-LLM latency. The per-question filter fold
 * (matchedCount/topRefs) and the LLM call still run live, so answers stay correct;
 * only the catalogue vocabulary can lag by at most the TTL (invisible for search).
 */
interface CatalogueSnapshot {
  records: readonly InventoryRow[];
  bids: readonly CompetitorBidRecord[];
  facetText: string;
  /** Empty-filter inventory items (≤1000) scanned for the keyword grounding. */
  items: readonly InventoryItem[];
}

const CATALOGUE_CACHE_TTL_MS = 60_000;
const CATALOGUE_CACHE_KEY = 'assistant-catalogue';

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
  /** Short-TTL, single-flight cache of the whole-catalogue snapshot (see
   *  CatalogueSnapshot) — collapses concurrent cold requests to one DB load. */
  private readonly catalogueCache = new TtlCache<CatalogueSnapshot>();

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

    // Ground the model on the catalogue: facet vocabulary + a keyword sample. The
    // whole-catalogue read + facet fold live behind a short-TTL cache (see
    // CatalogueSnapshot / loadCatalogue), so on a warm cache this is ~free and only
    // the LLM call + the per-question filter fold below run live.
    const cat = await this.catalogueCache.getOrCompute(
      CATALOGUE_CACHE_KEY,
      CATALOGUE_CACHE_TTL_MS,
      () => this.loadCatalogue(),
    );
    const facetText = cat.facetText;

    // Tiny keyword sample to ground the narrative — without it the model has no
    // real refs to cite. Falls back to the first 20 active items if no keyword
    // matched (e.g. user asked "quels marchés ouverts ?" with no specifics).
    const needle = q.toLowerCase();
    const tokens = needle
      .split(/[\s,.;:!?]+/u)
      .filter((t) => t.length >= 3)
      .slice(0, 8);
    const scored = cat.items
      .map((it) => {
        const hay = `${it.reference} ${it.objet} ${it.buyerName} ${it.region} ${it.location ?? ''} ${it.secteur}`.toLowerCase();
        const hits = tokens.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
        return { it, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, MAX_SAMPLE_ROWS);
    const sample = scored.length > 0 ? scored : cat.items.slice(0, 20).map((it) => ({ it, hits: 0 }));
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
      // Force the exact {filters, answer} shape on Gemini (see schema comment);
      // 2048 leaves headroom for a real narrative answer alongside thinking tokens.
      responseSchema: ASSISTANT_RESPONSE_SCHEMA,
      maxTokens: 2048,
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
    // count and can show a preview without a second round-trip. Uses the cached
    // records/bids (≤ TTL stale) with a fresh `now` so lifecycle stays request-accurate.
    const filteredInv = buildInventory(cat.records, out.filters, new Date(), { limit: 1000 }, cat.bids);
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

  /** Loads the whole-catalogue snapshot the assistant grounds questions on. Uses
   *  the lean read-model loaders ONLY — findAllInventoryRows() (projected, no `raw`
   *  jsonb detoast) + listResultMarkets() (deduped ~1-row-per-consultation) — never
   *  findAll()/listAllBids(), which shipped the toasted 97k-row jsonb + the whole
   *  585k-row competitor_bid table and OOM-crashed the 792 MB core. Cached by ask(). */
  private async loadCatalogue(): Promise<CatalogueSnapshot> {
    const [records, bids] = await Promise.all([
      this.tenders.findAllInventoryRows(),
      this.intel.listResultMarkets(),
    ]);
    const inv = buildInventory(records, {}, new Date(), { limit: 1000 }, bids);
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
    return { records, bids, facetText, items: inv.items };
  }
}
