import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';
import type { TenderRecord } from './tender.repository';

/**
 * Tender Inventory (جرد) — turns the raw detected-tender stream into a
 * navigable catalogue. Classification is deterministic and derived from
 * fields the portal already gives us (procedure, buyer, objet): no LLM, no
 * stored extra columns, so it stays correct as the crawl widens.
 */

/** French display labels for the procedure facet. */
export const PROCEDURE_LABELS: Record<TenderProcedure, string> = {
  AOO: "Appel d'offres ouvert",
  AOR: "Appel d'offres restreint",
  concours: 'Concours',
  negocie: 'Marché négocié',
  bons_de_commande: 'Bons de commande',
};

/**
 * Morocco's 12 regions, each with the city/province/agency keywords most
 * likely to appear in a buyer name or objet. Inference scans accent-stripped
 * text; the first region with a keyword hit wins. Extend the keyword lists as
 * new buyers appear — order regions from most to least specific if keywords
 * could overlap.
 */
const REGION_KEYWORDS: ReadonlyArray<readonly [region: string, keywords: readonly string[]]> = [
  ['Souss-Massa', ['agadir', 'inezgane', 'taroudant', 'tiznit', 'chtouka', 'ait melloul', 'ait baha', 'ouled teima', 'souss', 'massa']],
  ['Tanger-Tétouan-Al Hoceïma', ['tanger', 'tetouan', 'al hoceima', 'larache', 'chefchaouen', 'chaouen', 'ouezzane', 'fnideq', 'mdiq', 'asilah', 'ksar el kebir']],
  ["L'Oriental", ['oujda', 'nador', 'berkane', 'taourirt', 'jerada', 'figuig', 'driouch', 'guercif', 'oriental', 'saidia', 'ahfir', 'bouarfa']],
  ['Fès-Meknès', ['fes', 'meknes', 'taza', 'sefrou', 'ifrane', 'taounate', 'moulay yacoub', 'el hajeb', 'boulemane', 'azrou', 'missour']],
  ['Rabat-Salé-Kénitra', ['rabat', 'sale', 'kenitra', 'skhirat', 'temara', 'khemisset', 'sidi kacem', 'sidi slimane', 'sidi yahya', 'tiflet']],
  ['Béni Mellal-Khénifra', ['beni mellal', 'khenifra', 'khouribga', 'fquih ben salah', 'azilal', 'kasba tadla', 'oued zem', 'demnate']],
  ['Casablanca-Settat', ['casablanca', 'casa', 'mohammedia', 'settat', 'berrechid', 'el jadida', 'jadida', 'benslimane', 'mediouna', 'nouaceur', 'sidi bennour', 'azemmour', 'bouznika']],
  ['Marrakech-Safi', ['marrakech', 'safi', 'essaouira', 'kelaa', 'el kelaa', 'chichaoua', 'rehamna', 'youssoufia', 'al haouz', 'ben guerir', 'benguerir', 'sraghna']],
  ['Drâa-Tafilalet', ['errachidia', 'ouarzazate', 'zagora', 'tinghir', 'midelt', 'rissani', 'erfoud', 'tafilalet', 'draa']],
  ['Guelmim-Oued Noun', ['guelmim', 'tan-tan', 'tantan', 'sidi ifni', 'assa', 'zag', 'oued noun']],
  ['Laâyoune-Sakia El Hamra', ['laayoune', 'boujdour', 'tarfaya', 'es-smara', 'smara', 'sakia']],
  ['Dakhla-Oued Ed-Dahab', ['dakhla', 'oued ed-dahab', 'oued eddahab', 'aousserd']],
];

const UNLOCATED = 'Non localisé';

/** Lowercases and strips diacritics for keyword matching. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a keyword into a whole-word matcher. Internal spaces/hyphens match
 * any run of separators; ASCII letter/digit boundaries on both sides stop a
 * short keyword ("assa", "sale", "casa") from matching inside a longer word
 * ("assainissement", "salée", "casablanca").
 */
function buildMatcher(keyword: string): RegExp {
  const body = keyword
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('[\\s-]+');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

// Precompiled once — the keyword lists never change at runtime.
const REGION_MATCHERS: ReadonlyArray<
  readonly [region: string, matchers: RegExp[]]
> = REGION_KEYWORDS.map(([region, keywords]) => [
  region,
  keywords.map(buildMatcher),
]);

/**
 * Best-effort region from buyer + objet text, matched on whole-word
 * boundaries. Returns the region label, or `null` when no keyword matches
 * (the caller buckets these under "Non localisé"). First region with a hit
 * wins, so REGION_KEYWORDS stays ordered most- to least-specific.
 */
export function inferRegion(buyerName: string, objet = ''): string | null {
  const haystack = normalize(`${buyerName} ${objet}`);
  for (const [region, matchers] of REGION_MATCHERS) {
    if (matchers.some((re) => re.test(haystack))) return region;
  }
  return null;
}

export interface InventoryFilters {
  procedure?: TenderProcedure;
  buyer?: string;
  region?: string;
  state?: PipelineState;
  /** Free-text search across reference, objet and buyer. */
  q?: string;
}

export interface InventoryFacet {
  key: string;
  label: string;
  count: number;
}

export interface InventoryItem {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  procedureLabel: string;
  objet: string;
  estimationMad?: number;
  deadlineAt: Date;
  pipelineState: PipelineState;
  daysLeft: number;
  region: string;
}

export interface InventoryFacets {
  procedures: InventoryFacet[];
  regions: InventoryFacet[];
  buyers: InventoryFacet[];
  states: InventoryFacet[];
}

export interface Inventory {
  /** Total tenders in the catalogue, before filtering. */
  total: number;
  /** Count after the active filters (before the display cap). */
  filteredCount: number;
  /** Rows actually returned (== items.length; ≤ filteredCount when capped). */
  returnedCount: number;
  /** Facet distributions over the WHOLE catalogue (stable navigation). */
  facets: InventoryFacets;
  /** The filtered, deadline-sorted, page-capped result rows. */
  items: InventoryItem[];
  filters: InventoryFilters;
}

export interface InventoryPaging {
  limit?: number;
  offset?: number;
}

/** Top N buyers by tender count are surfaced as facets; the rest stay searchable. */
const BUYER_FACET_LIMIT = 30;
/** Default and hard ceiling on rows returned per request (payload guard). */
const DEFAULT_ITEM_LIMIT = 300;
const MAX_ITEM_LIMIT = 1000;

interface Classified {
  record: TenderRecord;
  region: string;
}

function tallyTop(
  rows: readonly Classified[],
  key: (c: Classified) => string,
  limit?: number,
): InventoryFacet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const facets = [...counts.entries()]
    .map(([value, count]) => ({ key: value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit ? facets.slice(0, limit) : facets;
}

function matches(c: Classified, filters: InventoryFilters): boolean {
  if (filters.procedure && c.record.procedure !== filters.procedure) return false;
  if (filters.buyer && c.record.buyerName !== filters.buyer) return false;
  if (filters.region && c.region !== filters.region) return false;
  if (filters.state && c.record.pipelineState !== filters.state) return false;
  if (filters.q) {
    const needle = normalize(filters.q);
    const haystack = normalize(
      `${c.record.reference} ${c.record.objet} ${c.record.buyerName}`,
    );
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Builds the inventory: classifies every record, computes catalogue-wide
 * facet counts, then returns the filtered, deadline-sorted rows. Facets are
 * computed over the full catalogue so the filter UI never collapses to the
 * current selection.
 */
export function buildInventory(
  records: readonly TenderRecord[],
  filters: InventoryFilters,
  now: Date,
  paging: InventoryPaging = {},
): Inventory {
  const limit = Math.min(
    MAX_ITEM_LIMIT,
    Math.max(1, Math.floor(paging.limit ?? DEFAULT_ITEM_LIMIT)),
  );
  const offset = Math.max(0, Math.floor(paging.offset ?? 0));

  const classified: Classified[] = records.map((record) => ({
    record,
    region: inferRegion(record.buyerName, record.objet) ?? UNLOCATED,
  }));

  const procedures: InventoryFacet[] = (
    Object.keys(PROCEDURE_LABELS) as TenderProcedure[]
  )
    .map((proc) => ({
      key: proc,
      label: PROCEDURE_LABELS[proc],
      count: classified.filter((c) => c.record.procedure === proc).length,
    }))
    .filter((facet) => facet.count > 0);

  const facets: InventoryFacets = {
    procedures,
    regions: tallyTop(classified, (c) => c.region),
    buyers: tallyTop(classified, (c) => c.record.buyerName, BUYER_FACET_LIMIT),
    states: tallyTop(classified, (c) => c.record.pipelineState),
  };

  const matched: InventoryItem[] = classified
    .filter((c) => matches(c, filters))
    .map(({ record, region }) => ({
      id: record.id,
      reference: record.reference,
      buyerName: record.buyerName,
      procedure: record.procedure,
      procedureLabel: PROCEDURE_LABELS[record.procedure],
      objet: record.objet,
      estimationMad: record.estimationMad,
      deadlineAt: record.deadlineAt,
      pipelineState: record.pipelineState,
      daysLeft: daysUntil(record.deadlineAt, now),
      region,
    }))
    // Deadline ascending; reference breaks ties so order is stable regardless
    // of the repository's row order.
    .sort(
      (a, b) =>
        a.deadlineAt.getTime() - b.deadlineAt.getTime() ||
        a.reference.localeCompare(b.reference),
    );

  const items = matched.slice(offset, offset + limit);

  return {
    total: records.length,
    filteredCount: matched.length,
    returnedCount: items.length,
    facets,
    items,
    filters,
  };
}
