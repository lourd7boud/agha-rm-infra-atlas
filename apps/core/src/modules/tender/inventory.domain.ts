import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';
import type { TenderRecord } from './tender.repository';
import { readAiEnrichment, type AiEnrichment } from './ai-enrichment';
import {
  readDossierExtraction,
  type DossierExtraction,
} from './dossier-extraction';

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

function regionFromText(haystack: string): string | null {
  for (const [region, matchers] of REGION_MATCHERS) {
    if (matchers.some((re) => re.test(haystack))) return region;
  }
  return null;
}

/**
 * Best-effort region, matched on whole-word boundaries; `null` when nothing
 * matches (the caller buckets these under "Non localisé"). The lieu d'exécution
 * (location) is the authoritative geographic signal, so it is tried first; only
 * when it yields nothing do we fall back to buyer + objet text. First region
 * with a hit wins, so REGION_KEYWORDS stays ordered most- to least-specific.
 */
export function inferRegion(
  buyerName: string,
  objet = '',
  location = '',
): string | null {
  if (location) {
    const fromLocation = regionFromText(normalize(location));
    if (fromLocation) return fromLocation;
  }
  return regionFromText(normalize(`${buyerName} ${objet}`));
}

/**
 * Ouvrage segment (famille de travaux) inferred from the objet — the axis every
 * price/rebate distribution is later sliced on. Deterministic keyword match,
 * ordered specific → general; first family with a hit wins, else 'autre'.
 * Extend the keyword lists as new objets appear.
 */
const SEGMENT_KEYWORDS: ReadonlyArray<
  readonly [segment: string, keywords: readonly string[]]
> = [
  ['assainissement', ['assainissement', 'eaux usees', "station d'epuration", 'station d epuration', 'step', 'collecteur', 'egout', 'eaux pluviales']],
  ['eau_potable', ['eau potable', 'aep', 'adduction', 'alimentation en eau', "chateau d'eau", 'chateau d eau', 'conduite d eau', 'distribution d eau']],
  ['irrigation', ['irrigation', 'perimetre', 'goutte a goutte', 'aspersion', 'seguia', 'hydro agricole', 'hydro-agricole', 'reseau d irrigation', 'pmh']],
  ['barrage', ['barrage', 'digue', 'retenue collinaire', 'protection contre les inondations', 'protection contre les crues']],
  ['forage', ['forage', 'puits', 'captage', 'sondage', 'piezometre']],
  ['routes', ['voirie', 'chaussee', "ouvrage d'art", 'ouvrage d art', 'amenagement urbain', 'trottoir', 'route', 'piste']],
  ['electricite', ['electrification', 'electrique', 'eclairage', 'photovoltaique', 'pompage solaire', 'poste de transformation']],
  ['batiment', ['batiment', 'ecole', 'logement', 'salle de', 'centre de sante', 'dispensaire', 'mur de cloture', 'cloture']],
  ['genie_civil', ['genie civil', 'terrassement', 'beton arme', 'rehabilitation', 'amenagement', 'travaux divers']],
  ['etudes', ['etude', "maitrise d'oeuvre", 'maitrise d oeuvre', 'assistance technique', 'suivi et controle', 'topographi', 'expertise']],
  ['fourniture', ['fourniture', 'acquisition', 'equipement', 'materiel', 'gardiennage', 'nettoyage', 'location']],
];

const SEGMENT_MATCHERS: ReadonlyArray<
  readonly [segment: string, matchers: RegExp[]]
> = SEGMENT_KEYWORDS.map(([segment, keywords]) => [
  segment,
  keywords.map(buildMatcher),
]);

export function inferSegment(objet: string, buyerName = ''): string {
  const haystack = normalize(`${objet} ${buyerName}`);
  for (const [segment, matchers] of SEGMENT_MATCHERS) {
    if (matchers.some((re) => re.test(haystack))) return segment;
  }
  return 'autre';
}

/** Readable French sector label for the ouvrage segment (the "Secteur" column). */
export const SEGMENT_LABELS: Record<string, string> = {
  assainissement: 'Assainissement & eaux usées',
  eau_potable: 'Eau potable (AEP)',
  irrigation: 'Irrigation & hydro-agricole',
  barrage: 'Barrages & hydraulique',
  forage: "Forages & captage d'eau",
  routes: 'Routes & voirie',
  electricite: 'Électricité & éclairage',
  batiment: 'Bâtiment & construction',
  genie_civil: 'Génie civil',
  etudes: 'Études & assistance',
  fourniture: 'Fournitures & équipements',
  autre: 'Autres',
};

export function segmentLabel(segment: string): string {
  return SEGMENT_LABELS[segment] ?? 'Autres';
}

/**
 * Marché category — the legal trichotomy of Moroccan public procurement
 * (Travaux / Fournitures / Services). Deterministic keyword match on the objet,
 * ordered by signal strength: an explicit "travaux" wins; otherwise a supply
 * verb (acquisition / fourniture…) means Fournitures; otherwise a service verb
 * (étude / entretien / gardiennage…) means Services; else fall back to the
 * ouvrage segment. Mirrors how datao buckets the same objets.
 */
export type TenderCategory = 'Travaux' | 'Fournitures' | 'Services';

/**
 * Like buildMatcher but tolerates a French plural suffix (fourniture →
 * fournitures, étude → études). Used for category verbs, which routinely appear
 * pluralised in objets; the strict matcher stays for region/segment keywords
 * where a trailing letter would change the meaning.
 */
function buildLooseMatcher(keyword: string): RegExp {
  const body = keyword
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('[\\s-]+');
  return new RegExp(`(?<![a-z0-9])${body}s?(?![a-z0-9])`);
}

const TRAVAUX_MATCHER = buildLooseMatcher('travaux');
const FOURNITURE_CAT_MATCHERS = [
  'fourniture',
  'acquisition',
  'achat',
  'materiel',
  'equipement',
  'mobilier',
  'approvisionnement',
].map(buildLooseMatcher);
const SERVICE_CAT_MATCHERS = [
  'etude',
  'assistance technique',
  "maitrise d'oeuvre",
  'maitrise d oeuvre',
  'gardiennage',
  'nettoyage',
  'entretien',
  'maintenance',
  'location',
  'formation',
  'audit',
  'prestation',
  'service',
  'surveillance',
  'controle',
  'suivi',
  'essais',
  'expertise',
  'conseil',
  'sondage',
  'transport',
  'restauration',
  'organisation',
].map(buildLooseMatcher);

export function inferCategory(objet: string): TenderCategory {
  const haystack = normalize(objet);
  if (TRAVAUX_MATCHER.test(haystack)) return 'Travaux';
  if (FOURNITURE_CAT_MATCHERS.some((re) => re.test(haystack))) return 'Fournitures';
  if (SERVICE_CAT_MATCHERS.some((re) => re.test(haystack))) return 'Services';
  const segment = inferSegment(objet);
  if (segment === 'fourniture') return 'Fournitures';
  if (segment === 'etudes' || segment === 'autre') return 'Services';
  return 'Travaux';
}

/**
 * Major Moroccan cities as [display, keywords]. Best-effort Ville from buyer +
 * objet, matched on whole-word boundaries; first hit wins, null when nothing
 * matches (the caller shows "—"). Ordered most- to least-specific.
 */
const CITY_KEYWORDS: ReadonlyArray<readonly [city: string, keywords: readonly string[]]> = [
  ['Agadir', ['agadir']],
  ['Inezgane', ['inezgane', 'ait melloul']],
  ['Taroudant', ['taroudant']],
  ['Tiznit', ['tiznit']],
  ['Tanger', ['tanger']],
  ['Tétouan', ['tetouan']],
  ['Al Hoceïma', ['al hoceima']],
  ['Larache', ['larache']],
  ['Chefchaouen', ['chefchaouen', 'chaouen']],
  ['Ouezzane', ['ouezzane']],
  ['Oujda', ['oujda']],
  ['Nador', ['nador']],
  ['Berkane', ['berkane']],
  ['Taourirt', ['taourirt']],
  ['Jerada', ['jerada']],
  ['Figuig', ['figuig']],
  ['Driouch', ['driouch']],
  ['Guercif', ['guercif']],
  ['Fès', ['fes']],
  ['Meknès', ['meknes']],
  ['Taza', ['taza']],
  ['Sefrou', ['sefrou']],
  ['Ifrane', ['ifrane']],
  ['Taounate', ['taounate']],
  ['El Hajeb', ['el hajeb']],
  ['Boulemane', ['boulemane']],
  ['Rabat', ['rabat']],
  ['Salé', ['sale']],
  ['Kénitra', ['kenitra']],
  ['Témara', ['temara']],
  ['Skhirat', ['skhirat']],
  ['Khémisset', ['khemisset']],
  ['Sidi Kacem', ['sidi kacem']],
  ['Sidi Slimane', ['sidi slimane']],
  ['Béni Mellal', ['beni mellal']],
  ['Khénifra', ['khenifra']],
  ['Khouribga', ['khouribga']],
  ['Fquih Ben Salah', ['fquih ben salah']],
  ['Azilal', ['azilal']],
  ['Oued Zem', ['oued zem']],
  ['Casablanca', ['casablanca', 'casa']],
  ['Mohammedia', ['mohammedia']],
  ['Settat', ['settat']],
  ['Berrechid', ['berrechid']],
  ['El Jadida', ['el jadida', 'jadida']],
  ['Benslimane', ['benslimane']],
  ['Nouaceur', ['nouaceur']],
  ['Sidi Bennour', ['sidi bennour']],
  ['Marrakech', ['marrakech', 'haouz', 'al haouz']],
  ['Safi', ['safi']],
  ['Essaouira', ['essaouira']],
  ['El Kelâa des Sraghna', ['el kelaa', 'kelaa']],
  ['Chichaoua', ['chichaoua']],
  ['Youssoufia', ['youssoufia']],
  ['Ben Guerir', ['ben guerir', 'benguerir']],
  ['Errachidia', ['errachidia']],
  ['Ouarzazate', ['ouarzazate']],
  ['Zagora', ['zagora']],
  ['Tinghir', ['tinghir']],
  ['Midelt', ['midelt']],
  ['Erfoud', ['erfoud']],
  ['Rissani', ['rissani']],
  ['Guelmim', ['guelmim']],
  ['Tan-Tan', ['tan-tan', 'tantan']],
  ['Sidi Ifni', ['sidi ifni']],
  ['Laâyoune', ['laayoune']],
  ['Boujdour', ['boujdour']],
  ['Es-Smara', ['es-smara', 'smara']],
  ['Dakhla', ['dakhla']],
];

const CITY_MATCHERS: ReadonlyArray<readonly [city: string, matchers: RegExp[]]> =
  CITY_KEYWORDS.map(([city, keywords]) => [city, keywords.map(buildMatcher)]);

function villeFromText(haystack: string): string | null {
  for (const [city, matchers] of CITY_MATCHERS) {
    if (matchers.some((re) => re.test(haystack))) return city;
  }
  return null;
}

export function inferVille(
  buyerName: string,
  objet = '',
  location = '',
): string | null {
  // Lieu d'exécution is the precise geographic signal — prefer it.
  if (location) {
    const fromLocation = villeFromText(normalize(location));
    if (fromLocation) return fromLocation;
  }
  return villeFromText(normalize(`${buyerName} ${objet}`));
}

/** Spelled-out French lot counts that appear in objets ("en deux lots"). */
const FRENCH_NUMBERS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

/**
 * Best-effort number of lots parsed from the objet. Recognises "lot unique",
 * numeric "(02 lots)" / "en 2 lots", and spelled-out "en deux lots". Defaults
 * to 1 — every marché has at least one lot — until the crawler captures the
 * real lot structure (Phase B).
 */
export function inferLotCount(objet: string): number {
  const haystack = normalize(objet);
  if (/lot\s+unique/.test(haystack)) return 1;
  const numeric = haystack.match(/(\d{1,3})\s*lots?\b/);
  if (numeric?.[1]) {
    const n = Number.parseInt(numeric[1], 10);
    if (n >= 1 && n <= 99) return n;
  }
  const word = haystack.match(
    /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+lots?\b/,
  );
  const token = word?.[1];
  if (token) return FRENCH_NUMBERS[token] ?? 1;
  return 1;
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
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  /** Detection timestamp — best-effort "Date de publication" until the crawler
   *  captures the portal's real publication date (Phase B). */
  publishedAt: Date;
  pipelineState: PipelineState;
  daysLeft: number;
  region: string;
  ville: string | null;
  /** Lieu d'exécution as printed on the portal (precise; may list several). */
  location: string | null;
  category: TenderCategory;
  secteur: string;
  /** Best-effort number of lots parsed from the objet (defaults to 1). */
  lotCount: number;
  /** Portal detail URL — powers Télécharger / Soumission en ligne. */
  sourceUrl?: string;
  // ── AI enrichment (fast model) — present once the tender is enriched ──
  aiResume?: string;
  faq?: Array<{ question: string; reponse: string }>;
  lotsDetail?: Array<{ designation: string; description?: string | null }>;
  conditions?: {
    cautionDefinitivePct?: number | null;
    retenueGarantiePct?: number | null;
    delaiGarantieMois?: number | null;
  };
  reserveAuxPme?: boolean;
  enrichedAt?: string;
  // ── Dossier extraction (REAL DCE data) — present once the DCE was read ──
  bpu?: Array<{
    designation: string;
    quantite?: number | null;
    unite?: string | null;
    prixUnitaireMad?: number | null;
  }>;
  qualifications?: Array<{
    secteur?: string | null;
    qualification?: string | null;
    classe?: string | null;
  }>;
  chiffreAffairesMinMad?: number | null;
  delaiExecutionMois?: number | null;
  /** true when estimationMad came from the real DCE (not the listing). */
  budgetFromDossier?: boolean;
  /**
   * Per-field DCE provenance for the conditions: a non-null value here means
   * THAT figure was read from the dossier (so the UI can mark only those as
   * verified, not the AI-fallback ones). Absent when no dossier was extracted.
   */
  dossierConditions?: {
    cautionDefinitivePct: number | null;
    retenueGarantiePct: number | null;
    delaiGarantieMois: number | null;
  };
  /** ISO timestamp the DCE dossier was read (provenance marker). */
  dossierExtractedAt?: string;
}

export interface InventoryFacets {
  procedures: InventoryFacet[];
  categories: InventoryFacet[];
  secteurs: InventoryFacet[];
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
  ville: string | null;
  location: string | null;
  category: TenderCategory;
  secteur: string;
  ai: AiEnrichment | null;
  dossier: DossierExtraction | null;
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

  const classified: Classified[] = records.map((record) => {
    const ai = readAiEnrichment(record.raw);
    return {
      record,
      region: inferRegion(record.buyerName, record.objet, record.location) ?? UNLOCATED,
      ville: inferVille(record.buyerName, record.objet, record.location),
      location: record.location ?? null,
      category: inferCategory(record.objet),
      // AI secteur wins when enriched, else the deterministic ouvrage label.
      secteur: ai?.secteur ?? segmentLabel(inferSegment(record.objet, record.buyerName)),
      ai,
      dossier: readDossierExtraction(record.raw),
    };
  });

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
    categories: tallyTop(classified, (c) => c.category),
    secteurs: tallyTop(classified, (c) => c.secteur),
    regions: tallyTop(classified, (c) => c.region),
    buyers: tallyTop(classified, (c) => c.record.buyerName, BUYER_FACET_LIMIT),
    states: tallyTop(classified, (c) => c.record.pipelineState),
  };

  const matched: InventoryItem[] = classified
    .filter((c) => matches(c, filters))
    .map(({ record, region, ville, location, category, secteur, ai, dossier }) => ({
      id: record.id,
      reference: record.reference,
      buyerName: record.buyerName,
      procedure: record.procedure,
      procedureLabel: PROCEDURE_LABELS[record.procedure],
      objet: record.objet,
      estimationMad: record.estimationMad,
      cautionProvisoireMad: record.cautionProvisoireMad,
      deadlineAt: record.deadlineAt,
      publishedAt: record.createdAt,
      pipelineState: record.pipelineState,
      daysLeft: daysUntil(record.deadlineAt, now),
      region,
      ville,
      location,
      category,
      secteur,
      // Real lot count: prefer the dossier BPU breadth, then the AI lots, else parsed.
      lotCount:
        dossier && dossier.bpu.length > 0
          ? dossier.bpu.length
          : ai && ai.lots.length > 0
            ? ai.lots.length
            : inferLotCount(record.objet),
      sourceUrl: record.sourceUrl,
      aiResume: ai?.resume,
      faq: ai?.faq,
      lotsDetail: ai?.lots,
      // Conditions: the real DCE figures win per-field, the AI guess fills gaps.
      conditions: {
        cautionDefinitivePct:
          dossier?.cautionDefinitivePct ?? ai?.conditions?.cautionDefinitivePct ?? null,
        retenueGarantiePct:
          dossier?.retenueGarantiePct ?? ai?.conditions?.retenueGarantiePct ?? null,
        delaiGarantieMois:
          dossier?.delaiGarantieMois ?? ai?.conditions?.delaiGarantieMois ?? null,
      },
      reserveAuxPme: ai?.reserveAuxPme,
      enrichedAt: ai?.enrichedAt,
      // Real DCE extraction (datao-grade) when present.
      bpu: dossier?.bpu,
      qualifications: dossier?.qualifications,
      chiffreAffairesMinMad: dossier?.chiffreAffairesMinMad ?? null,
      delaiExecutionMois: dossier?.delaiExecutionMois ?? null,
      budgetFromDossier: dossier?.estimationMad != null,
      dossierConditions: dossier
        ? {
            cautionDefinitivePct: dossier.cautionDefinitivePct ?? null,
            retenueGarantiePct: dossier.retenueGarantiePct ?? null,
            delaiGarantieMois: dossier.delaiGarantieMois ?? null,
          }
        : undefined,
      dossierExtractedAt: dossier?.extractedAt,
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
