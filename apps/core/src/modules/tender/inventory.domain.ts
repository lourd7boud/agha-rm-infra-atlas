import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';
import { readAiEnrichment } from './ai-enrichment';
import { readDossierExtraction } from './dossier-extraction';
import { readPortalDetail, type PortalDetail } from './portal-detail';
import {
  canonicalReferenceKey,
  type CompetitorBidRecord,
} from '../intel/intel.repository';

/**
 * Consultation-side lifecycle (datao spine: En cours / Clôturés / Résultats),
 * distinct from `pipelineState` which is OUR internal bid funnel. Computed at
 * read-time from deadline + harvested results (no extra column to maintain).
 */
export type LifecycleStatus = 'en_cours' | 'cloture' | 'attribue' | 'infructueux';

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  en_cours: 'En cours',
  cloture: 'Clôturé',
  attribue: 'Attribué',
  infructueux: 'Infructueux',
};

/** Public shape of a winner/loser on a tender — what the drawer renders. */
export interface TenderCompetitor {
  bidderName: string;
  amountMad: number | null;
  isWinner: boolean;
}

function lifecycleStatus(
  deadlineAt: Date,
  competitors: readonly TenderCompetitor[],
  now: Date,
): LifecycleStatus {
  // A result (attribution / infructueux) can only exist AFTER the submission
  // deadline + opening. While the deadline is still ahead the tender is "en
  // cours" no matter what — a matched bid there is a reference collision, never
  // a real result. This is the guard that stops open tenders showing "Attribué".
  if (deadlineAt.getTime() >= now.getTime()) return 'en_cours';
  if (competitors.length > 0) {
    return competitors.some((c) => c.isWinner) ? 'attribue' : 'infructueux';
  }
  return 'cloture';
}

/**
 * Composite match key = canonical reference + canonical buyer. Portal references
 * are extremely generic ("05/2026" is reused by hundreds of different acheteurs),
 * so matching a harvested result to a tender by reference ALONE mis-attributes it
 * to an unrelated buyer's tender (a wall-construction market showing IT-supplier
 * "bidders"). Both sides canonicalize the buyer the same way (canonicalReferenceKey
 * is a generic lower/accent-fold/alnum canonicalizer that only ever emits
 * [a-z0-9 ]), so a "|" separator can never appear inside either part and keeps
 * the two from bleeding into each other.
 */
function refBuyerKey(reference: string, buyerName: string): string {
  return `${canonicalReferenceKey(reference)}|${canonicalReferenceKey(buyerName)}`;
}

/** Indexes bids by (reference + buyer) key so a single scan answers all tenders. */
function indexBidsByRefAndBuyer(
  bids: readonly CompetitorBidRecord[],
): Map<string, CompetitorBidRecord[]> {
  const out = new Map<string, CompetitorBidRecord[]>();
  for (const bid of bids) {
    const key = refBuyerKey(bid.reference, bid.buyerName);
    const list = out.get(key);
    if (list) list.push(bid);
    else out.set(key, [bid]);
  }
  return out;
}

/** The read-time consultation state a tender derives from its deadline + bids. */
export interface ResolvedBidState {
  competitors: TenderCompetitor[];
  lifecycle: LifecycleStatus;
  resultDate: Date | null;
}

/**
 * Single source of truth for the read-time lifecycle/competitor/result fold,
 * reused by BOTH the JS pipeline (selectInventory) and the DB-side page
 * (findInventoryPage) so the lifecycle status/facet can never drift between the
 * two. Build it once from the tiny bid set, then resolve per reference+deadline.
 */
export class BidResolver {
  private readonly byRefBuyer: Map<string, CompetitorBidRecord[]>;

  constructor(bids: readonly CompetitorBidRecord[]) {
    this.byRefBuyer = indexBidsByRefAndBuyer(bids);
  }

  resolve(
    reference: string,
    buyerName: string,
    deadlineAt: Date,
    now: Date,
  ): ResolvedBidState {
    // Deadline still ahead → the tender is open; a published result cannot exist
    // yet, so surface NO competitors/result and keep it en_cours. This also
    // neutralises any residual reference+buyer collision (belt-and-suspenders on
    // top of the buyer-scoped key below).
    if (deadlineAt.getTime() >= now.getTime()) {
      return { competitors: [], lifecycle: 'en_cours', resultDate: null };
    }
    const matched = this.byRefBuyer.get(refBuyerKey(reference, buyerName)) ?? [];
    const competitors: TenderCompetitor[] = matched.map((b) => ({
      bidderName: b.bidderName,
      amountMad: b.amountMad ?? null,
      isWinner: b.isWinner,
    }));
    const resultDate =
      matched
        .map((b) => b.resultDate)
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      competitors,
      lifecycle: lifecycleStatus(deadlineAt, competitors, now),
      resultDate,
    };
  }
}

/** Lifecycle order used for both the facet and the datao spine (En cours →
 *  Clôturé → Attribué → Infructueux). */
const LIFECYCLE_FACET_ORDER: LifecycleStatus[] = [
  'en_cours',
  'cloture',
  'attribue',
  'infructueux',
];

/**
 * Lifecycle facet over an arbitrary set of (reference, deadlineAt) rows — the
 * DB-side page feeds a minimal whole-catalogue projection here so the counts
 * stay catalogue-wide without recomputing regex/Zod classification. Empty
 * buckets are dropped, matching the JS facet.
 */
export function lifecycleFacetForRows(
  rows: ReadonlyArray<{ reference: string; buyerName: string; deadlineAt: Date }>,
  bids: readonly CompetitorBidRecord[],
  now: Date,
): InventoryFacet[] {
  const resolver = new BidResolver(bids);
  const counts = new Map<LifecycleStatus, number>();
  for (const row of rows) {
    const { lifecycle } = resolver.resolve(
      row.reference,
      row.buyerName,
      row.deadlineAt,
      now,
    );
    counts.set(lifecycle, (counts.get(lifecycle) ?? 0) + 1);
  }
  return LIFECYCLE_FACET_ORDER.map((key) => ({
    key,
    label: LIFECYCLE_LABELS[key],
    count: counts.get(key) ?? 0,
  })).filter((facet) => facet.count > 0);
}

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

/** Sortable columns for the inventory list (datao-parity server-side sort). */
export type InventorySortKey =
  | 'publication'
  | 'deadline'
  | 'estimation'
  | 'buyer'
  | 'daysLeft';
export type InventorySortDir = 'asc' | 'desc';

export interface InventoryFilters {
  procedure?: TenderProcedure;
  buyer?: string;
  region?: string;
  state?: PipelineState;
  /**
   * Consultation-side status — the datao spine (En cours / Clôturé / Attribué /
   * Infructueux). Distinct from `state` (our internal bid funnel).
   */
  lifecycle?: LifecycleStatus;
  /** Free-text search across reference, objet and buyer. */
  q?: string;
  /** Delta cutoff: when set, only rows written AFTER this instant are returned
   *  (facets/total still reflect the full catalogue). Powers live silent refresh
   *  — the client polls `?since=<lastSeen>` and merges just the changed rows. */
  since?: Date;
  // ── Multi-select (datao-style) — a row passes a dimension when the set is
  //    empty OR contains the row's value. Merged with the single-value param of
  //    the same dimension so the SSR/preload single params keep working. ──
  procedures?: string[];
  categories?: string[];
  secteurs?: string[];
  regions?: string[];
  buyers?: string[];
  states?: string[];
  lifecycles?: string[];
  // ── Boolean toggles — narrow to rows that carry the given signal. ──
  /** Only rows whose dossier extraction carries at least one BPU line item. */
  bpuOnly?: boolean;
  /** Only rows with a known estimation (budget). */
  budgetOnly?: boolean;
  /** Only rows with a known caution provisoire. */
  cautionOnly?: boolean;
  // ── Sort (server-side) — defaults to publication DESC (newest first). ──
  sort?: InventorySortKey;
  dir?: InventorySortDir;
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
    section?: string | null;
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
  /** Whether the dossier extraction carries at least one BPU line item — a light
   *  flag the LIST rows show without shipping the heavy `bpu` array. */
  hasBpu?: boolean;
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
  /** Maître d'ouvrage contact from the DCE (datao's "Contact :" section). */
  contact?: {
    nom?: string | null;
    email?: string | null;
    telephone?: string | null;
  } | null;
  /** Regulatory references cited in the DCE (datao's "Conditions légales :"). */
  conditionsLegales?: string[];
  /** Other notable conditions (datao's "Autres :" — bullet list). */
  autres?: string[];
  /** ISO timestamp the DCE dossier was read (provenance marker). */
  dossierExtractedAt?: string;
  /**
   * The published portal metadata block (datao "fiche du portail") harvested by
   * the watch detail crawler into raw.detail — buyer entity, procédure, mode de
   * passation, lieu d'exécution/ouverture, domaines, réservé PME, variante,
   * visites des lieux, contact administratif (incl. télécopieur), etc. Zero LLM;
   * the drawer renders it with a "Portail" provenance badge.
   */
  portalDetail?: PortalDetail;
  // ── Consultation-side lifecycle + result (datao "Résultat de l'appel d'offre") ──
  /** Where the consultation stands on the portal (NOT our internal funnel). */
  lifecycleStatus: LifecycleStatus;
  /** Label for the lifecycle (En cours / Clôturé / Attribué / Infructueux). */
  lifecycleLabel: string;
  /** Winning bidder when known, else null. Drives the "Attribué à" surface. */
  winner: TenderCompetitor | null;
  /** All bidders we know about (winner + losers), empty when no result harvested. */
  competitors: TenderCompetitor[];
  /** ISO date the result was published (from the PV/notice), when known. */
  resultDate?: string;
  /** ISO timestamp of the row's last write — the client tracks the max seen and
   *  sends it back as `?since=` so live polls only fetch what changed. */
  updatedAt: string;
}

export interface InventoryFacets {
  procedures: InventoryFacet[];
  categories: InventoryFacet[];
  secteurs: InventoryFacet[];
  regions: InventoryFacet[];
  buyers: InventoryFacet[];
  states: InventoryFacet[];
  /** Tous / En cours / Clôturé / Attribué / Infructueux — the datao spine. */
  lifecycles: InventoryFacet[];
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

/**
 * Light projection of a tender for the LIST path — every column the classify /
 * facet / filter / sort passes need, WITHOUT the heavy `raw` JSONB. The
 * repository ships this for the WHOLE catalogue (raw never crosses the wire for
 * all rows); `raw` is loaded only for the visible page's full records and folded
 * in during hydration. `TenderRecord` is structurally assignable to it, so
 * callers holding full records reuse the same path.
 */
export interface InventoryRow {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  location?: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  sourceUrl?: string;
  pipelineState: PipelineState;
  createdAt: Date;
  updatedAt: Date;
  // ── Light enrichment, projected from `raw` INSIDE the SQL (Drizzle) or read
  //    via readAiEnrichment/readDossierExtraction (InMemory). These let the LIST
  //    path build display items WITHOUT parsing the heavy `raw` per row. ──
  /** Whether the dossier extraction carries at least one BPU line item. Null on a
   *  full record whose has_bpu column is not yet backfilled. */
  hasBpu?: boolean | null;
  /** Number of BPU line items in the dossier extraction (0 when none). */
  bpuCount?: number;
  /** AI-enrichment résumé line, when the tender was enriched. */
  aiResume?: string;
  /** AI-enrichment fine secteur label, when enriched. */
  aiSecteur?: string;
  /** ISO timestamp the AI enrichment was written, when enriched. */
  aiEnrichedAt?: string;
  /** true when the estimation came from the real DCE dossier (not the listing). */
  budgetFromDossier?: boolean;
  // ── Denormalized classification (migration 0033), projected straight from the
  //    stored columns. Named to match TenderRecord so a full record stays
  //    structurally assignable to InventoryRow. NULL/undefined until the write
  //    path / backfill populates them; the classify pass (classifyRow) falls back
  //    to on-the-fly inference PER FIELD when a value is null, so the read stays
  //    correct before the backfill has run. secteur is the French LABEL
  //    (segmentLabel), category is Travaux/Fournitures/Services, region is the
  //    region name or UNLOCATED, lotCount is the parsed count (≥1). ──
  region?: string | null;
  ville?: string | null;
  category?: string | null;
  secteur?: string | null;
  lotCount?: number | null;
  /** Present only when hydrated from the full record; omitted by the projected
   *  list query so raw never crosses the wire for the whole catalogue. */
  raw?: Record<string, unknown> | null;
}

/**
 * Result of selectInventory (phase 1): catalogue-wide facets + the LIGHT
 * classified page, before the heavy `raw` hydration. `pageIds` is the id list to
 * load full records for (the projected path calls findByIds with it).
 */
export interface InventorySelection {
  total: number;
  filteredCount: number;
  facets: InventoryFacets;
  filters: InventoryFilters;
  page: Classified[];
  pageIds: string[];
}

/** Top N buyers by tender count are surfaced as facets; the rest stay searchable.
 *  Exported so the DB-side page (findInventoryPage) caps the buyers GROUP BY at
 *  the SAME limit as the JS tallyTop. */
export const BUYER_FACET_LIMIT = 30;
/** Default and hard ceiling on rows returned per request (payload guard).
 *  MAX_ITEM_LIMIT must stay in sync with inventoryQuerySchema.limit's .max()
 *  in tender.module.ts — they're two halves of the same guard. Current
 *  catalogue is ~4264 active rows (datao parity), 5000 leaves ~700 head-room.
 *  When live count approaches MAX_ITEM_LIMIT a WARN is logged from the route
 *  handler so we notice before users see a silent truncation. Exported so the
 *  DB-side page clamps its LIMIT/OFFSET identically to the JS slice. */
export const DEFAULT_ITEM_LIMIT = 300;
export const MAX_ITEM_LIMIT = 5000;

/** Clamps a requested page size to [1, MAX_ITEM_LIMIT], defaulting to
 *  DEFAULT_ITEM_LIMIT — the SAME clamp selectInventory applies, so the DB LIMIT
 *  and the JS slice agree. */
export function clampInventoryLimit(limit: number | undefined): number {
  return Math.min(MAX_ITEM_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_ITEM_LIMIT)));
}

interface Classified {
  record: InventoryRow;
  region: string;
  ville: string | null;
  location: string | null;
  category: TenderCategory;
  /** Deterministic ouvrage label — the secteur FACET + the fallback for the
   *  per-item displayed secteur. The AI free-text secteur (from raw) is applied
   *  only when the row is hydrated for the visible page (see buildItem). */
  secteur: string;
  lifecycle: LifecycleStatus;
  competitors: TenderCompetitor[];
  resultDate: Date | null;
}

/**
 * The deterministic classification of a tender — the values persisted to the
 * denormalized columns (migration 0033) at WRITE time and read back on the hot
 * list path. secteur is the French LABEL (segmentLabel), matching the facet /
 * filter semantics exactly; region is the region name or UNLOCATED; ville is
 * null when no city matches; category is Travaux/Fournitures/Services; lotCount
 * is the best-effort parse (≥1). Excludes hasBpu (that depends on the raw
 * dossier, recomputed on extraction — see classifyHasBpu).
 */
export interface StorageClassification {
  region: string;
  ville: string | null;
  category: TenderCategory;
  secteur: string;
  lotCount: number;
}

/**
 * Computes the deterministic classification from the listing fields, for the
 * WRITE path (create / heal). Pure + DRY: the single source of truth for what
 * each classification column holds. Mirrors exactly what selectInventory used to
 * compute inline, so denormalizing changes no observable value.
 */
export function classifyForStorage(input: {
  buyerName: string;
  objet: string;
  location?: string | null;
}): StorageClassification {
  const objet = input.objet;
  const location = input.location ?? '';
  return {
    region: inferRegion(input.buyerName, objet, location) ?? UNLOCATED,
    ville: inferVille(input.buyerName, objet, location),
    category: inferCategory(objet),
    secteur: segmentLabel(inferSegment(objet, input.buyerName)),
    lotCount: inferLotCount(objet),
  };
}

/**
 * Per-row classification for the READ path: prefers the denormalized columns
 * (populated by the write path / backfill) and falls back to on-the-fly
 * inference PER FIELD when a column is null — so the list stays correct before
 * the backfill has run and can never show a wrong bucket for a freshly-migrated
 * row. Each field falls back independently (a null region does not force a
 * re-inference of ville, and vice-versa).
 */
function classifyRow(record: InventoryRow): StorageClassification {
  const region =
    record.region ??
    (inferRegion(record.buyerName, record.objet, record.location) ?? UNLOCATED);
  const ville =
    record.ville != null
      ? record.ville
      : inferVille(record.buyerName, record.objet, record.location);
  const category = (record.category ??
    inferCategory(record.objet)) as TenderCategory;
  const secteur =
    record.secteur ?? segmentLabel(inferSegment(record.objet, record.buyerName));
  const lotCount =
    record.lotCount != null && record.lotCount > 0
      ? record.lotCount
      : inferLotCount(record.objet);
  return { region, ville, category, secteur, lotCount };
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

/**
 * Effective set for a dimension: the single-value param (when present) unioned
 * with the multi-select array. Returns null when neither is set — the caller
 * reads null as "no constraint on this dimension" (every row passes). Keeps the
 * SSR/preload single params working alongside the new comma-separated multi params.
 */
function effectiveSet(
  single: string | undefined,
  multi: readonly string[] | undefined,
): ReadonlySet<string> | null {
  const values: string[] = [];
  if (single) values.push(single);
  if (multi) values.push(...multi);
  return values.length > 0 ? new Set(values) : null;
}

function matches(c: Classified, filters: InventoryFilters): boolean {
  if (filters.since && c.record.updatedAt.getTime() <= filters.since.getTime()) return false;

  const procedures = effectiveSet(filters.procedure, filters.procedures);
  if (procedures && !procedures.has(c.record.procedure)) return false;

  const buyers = effectiveSet(filters.buyer, filters.buyers);
  if (buyers && !buyers.has(c.record.buyerName)) return false;

  const regions = effectiveSet(filters.region, filters.regions);
  if (regions && !regions.has(c.region)) return false;

  const states = effectiveSet(filters.state, filters.states);
  if (states && !states.has(c.record.pipelineState)) return false;

  const lifecycles = effectiveSet(filters.lifecycle, filters.lifecycles);
  if (lifecycles && !lifecycles.has(c.lifecycle)) return false;

  const categories = effectiveSet(undefined, filters.categories);
  if (categories && !categories.has(c.category)) return false;

  const secteurs = effectiveSet(undefined, filters.secteurs);
  if (secteurs && !secteurs.has(c.secteur)) return false;

  if (filters.bpuOnly && c.record.hasBpu !== true) return false;
  if (filters.budgetOnly && c.record.estimationMad == null) return false;
  if (filters.cautionOnly && c.record.cautionProvisoireMad == null) return false;

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
 * Comparator for the requested sort key over classified rows. Publication maps
 * to `createdAt`, deadline/daysLeft both to `deadlineAt` (daysLeft is a monotone
 * function of the deadline), estimation to `estimationMad` (missing sorts last in
 * either direction via ±Infinity fed through the dir flip), and buyer to a locale
 * compare of the buyer name. Reference always breaks ties so the order is stable
 * regardless of the repository's row order. `dir` flips the primary comparison
 * only; the reference tiebreak stays ascending for determinism.
 */
function compareBySort(
  a: Classified,
  b: Classified,
  sort: InventorySortKey,
  dir: InventorySortDir,
): number {
  const sign = dir === 'asc' ? 1 : -1;
  let primary: number;
  switch (sort) {
    case 'deadline':
    case 'daysLeft':
      primary = a.record.deadlineAt.getTime() - b.record.deadlineAt.getTime();
      break;
    case 'estimation':
      primary =
        (a.record.estimationMad ?? -Infinity) - (b.record.estimationMad ?? -Infinity);
      break;
    case 'buyer':
      primary = a.record.buyerName.localeCompare(b.record.buyerName);
      break;
    case 'publication':
    default:
      primary = a.record.createdAt.getTime() - b.record.createdAt.getTime();
      break;
  }
  if (primary !== 0) return sign * primary;
  return a.record.reference.localeCompare(b.record.reference);
}

/**
 * Hydrates ONE visible row into the rich InventoryItem — the only place the
 * heavy `raw` JSONB (ai enrichment + dossier extraction) is parsed. Called for
 * the paginated page only, never the whole catalogue.
 */
function buildItem(c: Classified, now: Date): InventoryItem {
  const { record } = c;
  const ai = readAiEnrichment(record.raw);
  const dossier = readDossierExtraction(record.raw);
  // Published portal block (zero LLM) — the source of truth for facts the portal
  // prints. Parsed once and reused below (reserveAuxPme + portalDetail).
  const pd = readPortalDetail(record.raw);
  return {
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
    region: c.region,
    ville: c.ville,
    location: c.location,
    category: c.category,
    // AI secteur wins when enriched, else the deterministic ouvrage label.
    secteur: ai?.secteur ?? c.secteur,
    // Real lot count: prefer the dossier BPU breadth, then the AI lots, then the
    // stored (denormalized) lot count, else parse the objet on the fly.
    lotCount:
      dossier && dossier.bpu.length > 0
        ? dossier.bpu.length
        : ai && ai.lots.length > 0
          ? ai.lots.length
          : record.lotCount && record.lotCount > 0
            ? record.lotCount
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
    // Portal-first: the published "Réservé aux PME" wins (incl. an explicit
    // false); the LLM guess only fills the gap when the portal didn't print it.
    reserveAuxPme: pd?.reserveAuxPme ?? ai?.reserveAuxPme,
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
    contact: dossier?.contact ?? undefined,
    conditionsLegales: dossier?.conditionsLegales,
    autres: dossier?.autres,
    dossierExtractedAt: dossier?.extractedAt,
    // Portal-first: the published detail block (no LLM). Undefined until the
    // detail crawler has stamped raw.detail for this row.
    portalDetail: pd ?? undefined,
    lifecycleStatus: c.lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[c.lifecycle],
    winner: c.competitors.find((x) => x.isWinner) ?? null,
    competitors: c.competitors,
    resultDate: c.resultDate ? c.resultDate.toISOString() : undefined,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Builds a LIGHT InventoryItem for the LIST path — from the row's PROJECTED
 * light-enrichment fields (hasBpu / bpuCount / aiResume / aiSecteur /
 * aiEnrichedAt / budgetFromDossier), WITHOUT parsing the heavy `raw` JSONB. The
 * heavy dossier arrays (bpu / faq / lotsDetail / qualifications / conditions /
 * contact …) are the detail drawer's job (GET /tender/tenders/:id) and are left
 * undefined here — so a 5 000-row catalogue ships ~1-2 MB with zero per-row Zod
 * parse instead of ~14 MB and two safeParses per row.
 */
export function buildLightItem(c: Classified, now: Date): InventoryItem {
  const { record } = c;
  return {
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
    region: c.region,
    ville: c.ville,
    location: c.location,
    category: c.category,
    // AI secteur (projected) wins when enriched, else the deterministic label.
    secteur: record.aiSecteur ?? c.secteur,
    // Real lot count: prefer the projected dossier BPU breadth, then the stored
    // (denormalized) lot count, else parse the objet on the fly.
    lotCount:
      record.bpuCount && record.bpuCount > 0
        ? record.bpuCount
        : record.lotCount && record.lotCount > 0
          ? record.lotCount
          : inferLotCount(record.objet),
    sourceUrl: record.sourceUrl,
    aiResume: record.aiResume,
    hasBpu: record.hasBpu ?? false,
    enrichedAt: record.aiEnrichedAt,
    budgetFromDossier: record.budgetFromDossier ?? false,
    lifecycleStatus: c.lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[c.lifecycle],
    winner: c.competitors.find((x) => x.isWinner) ?? null,
    competitors: c.competitors,
    resultDate: c.resultDate ? c.resultDate.toISOString() : undefined,
    updatedAt: record.updatedAt.toISOString(),
    // Heavy fields (bpu / faq / lotsDetail / qualifications / conditions /
    // conditionsLegales / autres / contact / dossierConditions /
    // chiffreAffairesMinMad / delaiExecutionMois / reserveAuxPme) are OMITTED —
    // the detail drawer loads them via GET /tender/tenders/:id.
  };
}

/**
 * Phase 1 of the list read: classify every row from base columns (NO raw),
 * compute catalogue-wide facets, filter + sort, and select the visible page —
 * returning the LIGHT classified page (not yet hydrated). Facets span the whole
 * catalogue so the filter UI never collapses to the current selection. Split
 * from hydration so the controller can feed a projected (raw-less) row set here
 * and load raw only for the page (see hydrateInventory).
 */
export function selectInventory(
  records: readonly InventoryRow[],
  filters: InventoryFilters,
  now: Date,
  paging: InventoryPaging = {},
  bids: readonly CompetitorBidRecord[] = [],
): InventorySelection {
  const limit = clampInventoryLimit(paging.limit);
  const offset = Math.max(0, Math.floor(paging.offset ?? 0));

  // Index ALL bids once by canonical reference key (BidResolver), then attach to
  // each tender by reference fallback (tender_id is sparsely populated until the
  // back-fill runs at scale). Shared with the DB-side page so lifecycle can't drift.
  const resolver = new BidResolver(bids);

  // Classify EVERY row from base columns only — no `raw` JSONB parsing here.
  // The heavy ai/dossier reads happen once per VISIBLE row in buildItem, so a
  // 5 000-row catalogue no longer pays ~10 000 Zod parses per request.
  const classified: Classified[] = records.map((record) => {
    const { competitors, lifecycle, resultDate } = resolver.resolve(
      record.reference,
      record.buyerName,
      record.deadlineAt,
      now,
    );
    const classification = classifyRow(record);
    return {
      record,
      region: classification.region,
      ville: classification.ville,
      location: record.location ?? null,
      category: classification.category,
      // Deterministic ouvrage label for the facet; the AI secteur override is
      // applied per visible row in buildItem.
      secteur: classification.secteur,
      lifecycle,
      competitors,
      resultDate,
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

  // Lifecycle facet — surfaced in the order datao uses (En cours → Clôturé →
  // Attribué → Infructueux), with empty buckets dropped. Reuses the shared fold
  // so the JS and DB-side page counts stay identical.
  const lifecycles = lifecycleFacetForRows(
    classified.map((c) => c.record),
    bids,
    now,
  );

  const facets: InventoryFacets = {
    procedures,
    categories: tallyTop(classified, (c) => c.category),
    secteurs: tallyTop(classified, (c) => c.secteur),
    regions: tallyTop(classified, (c) => c.region),
    buyers: tallyTop(classified, (c) => c.record.buyerName, BUYER_FACET_LIMIT),
    states: tallyTop(classified, (c) => c.record.pipelineState),
    lifecycles,
  };

  // Filter + sort on the light classified rows (base columns only). The default
  // (publication DESC — newest first) matches datao's UX and ensures freshly
  // detected tenders appear on page 1 even when their deadlines are weeks away;
  // the previous deadline-ASC default hid every new posting behind the row cap
  // because new postings have far-future deadlines. Callers can override via
  // filters.sort / filters.dir. Reference breaks ties so order is stable
  // regardless of the repository's row order.
  const sort = filters.sort ?? 'publication';
  const dir = filters.dir ?? 'desc';
  const matched = classified
    .filter((c) => matches(c, filters))
    .sort((a, b) => compareBySort(a, b, sort, dir));

  const page = matched.slice(offset, offset + limit);
  return {
    total: records.length,
    filteredCount: matched.length,
    facets,
    filters,
    page,
    pageIds: page.map((c) => c.record.id),
  };
}

/**
 * Phase 2 of the list read: hydrate the selected page into rich InventoryItems,
 * reading the heavy `raw` JSONB ONLY for those rows. `records` supplies the FULL
 * records (with raw) for the page — the same objects for callers that already
 * hold them (buildInventory), or a `findByIds` result for the projected path.
 * Rows missing from `records` degrade to no enrichment (raw treated as absent).
 */
export function hydrateInventory(
  selection: InventorySelection,
  records: readonly InventoryRow[],
  now: Date,
): Inventory {
  const byId = new Map(records.map((record) => [record.id, record] as const));
  const items = selection.page.map((c) =>
    buildItem({ ...c, record: byId.get(c.record.id) ?? c.record }, now),
  );
  return {
    total: selection.total,
    filteredCount: selection.filteredCount,
    returnedCount: items.length,
    facets: selection.facets,
    items,
    filters: selection.filters,
  };
}

/**
 * Convenience for callers that already hold the FULL records (with raw): the
 * spec, the assistant, and the `?since=` delta path. Selects then hydrates from
 * the same records; the heavy `raw` parse still happens only for the page.
 */
export function buildInventory(
  records: readonly InventoryRow[],
  filters: InventoryFilters,
  now: Date,
  paging: InventoryPaging = {},
  bids: readonly CompetitorBidRecord[] = [],
): Inventory {
  const selection = selectInventory(records, filters, now, paging, bids);
  return hydrateInventory(selection, records, now);
}
