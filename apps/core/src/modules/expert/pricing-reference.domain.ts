/**
 * Pricing-reference engine — grounds the bordereau des prix in REAL data instead
 * of a blind LLM guess, so the agent gets sharper with every dossier it harvests.
 *
 * Three sources, best-first, applied per BPU line:
 *   1. 'dce'        — the maître d'ouvrage's OWN published unit price for THIS
 *                     bordereau (extraction.bpu[i].prixUnitaireMad). The gold
 *                     standard: used line-for-line, no matching needed.
 *   2. 'historique' — a price book learned from every priced détail estimatif the
 *                     platform has already extracted across the catalogue, matched
 *                     to each line by designation similarity. The more dossiers
 *                     harvested, the more lines this can price. THIS is the agent
 *                     "learning" from the market.
 *   3. 'ia'         — only the lines neither source can price fall through to the
 *                     LLM, which is handed the resolved anchors for consistency.
 *
 * Every published number stays deterministic downstream (bpu-pricing.domain
 * scales the whole vector onto estimation × (1 − rabais)); this module only
 * decides the RELATIVE weighting each line starts from — the better that
 * weighting, the more realistic the per-line split.
 */

/** A single priced reference line harvested from a real estimatif. */
export interface ReferenceBpuLine {
  designation: string;
  unite?: string | null;
  prixUnitaireMad: number;
}

/** One pre-tokenized price-book row (built once, matched many times). */
export interface PriceBookEntry {
  tokens: readonly string[];
  unite: string | null;
  prixUnitaireMad: number;
}

export type UnitPriceSource = 'dce' | 'historique' | 'ia' | 'aucune';

export interface ResolvedUnitPrice {
  /** The chosen relative unit price, or null when no source could price it. */
  prixUnitaireMad: number | null;
  source: UnitPriceSource;
  /** Match confidence: 1 for a DCE line, 0..1 for a price-book match, 0 otherwise. */
  score: number;
}

export interface PricingBasis {
  /** Lines priced straight from the DCE's own estimatif. */
  dce: number;
  /** Lines priced from the learned historical price book. */
  historique: number;
  /** Lines the LLM had to price. */
  ia: number;
  /** Lines nothing could price (fell back to uniform split downstream). */
  aucune: number;
}

/** Minimum similarity for a price-book match to be trusted (weighted Jaccard). */
export const MIN_MATCH_SCORE = 0.55;
/** How many top matches to median together (robust to a single outlier price). */
const MATCH_POOL = 5;
/** Shortest token kept — drops "de", "l", single letters, but keeps "ml", "dn". */
const MIN_TOKEN_LEN = 2;
/** A unit mismatch is a strong signal the two lines aren't the same work. */
const UNIT_MISMATCH_FACTOR = 0.6;

/**
 * French BTP designation stop-words + bare units that carry no discriminating
 * signal (every line has them). Kept small on purpose — over-stripping hurts
 * recall more than a few noise tokens hurt precision.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'au', 'aux',
  'pour', 'par', 'sur', 'sous', 'avec', 'sans', 'ou', 'a', 'l', 'd', 'y',
  'compris', 'toute', 'toutes', 'tout', 'tous', 'fourniture', 'pose', 'mise',
  'oeuvre', 'ml', 'ms', 'ff', 'ens', 'unite', 'unites', 'nombre', 'forfait',
]);

/** Strip diacritics so "câble" and "cable" tokenize identically. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Splits a designation into a de-duplicated set of significant tokens. Numeric
 * tokens (diameters, "dn200", "ø160") are KEPT — they discriminate strongly in
 * BTP ("conduite pvc dn200" vs "dn110"); only pure stop-words are dropped.
 */
export function tokenizeDesignation(designation: string): string[] {
  const raw = stripDiacritics(designation.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  const seen = new Set<string>();
  for (const token of raw) {
    if (token.length < MIN_TOKEN_LEN) continue;
    if (STOPWORDS.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/**
 * Normalizes a unit label for equality tests ("m3"/"M³"/"m 3" → "m3"). Uses
 * NFKD (compatibility decomposition) so the superscript "²"/"³" of "m²"/"m³"
 * fold to "2"/"3" — NFD alone leaves them intact and "m³" would collapse to "m".
 */
export function normalizeUnit(unite: string | null | undefined): string | null {
  if (!unite) return null;
  const cleaned = unite.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/** Weighted Jaccard over two token sets: |A∩B| / |A∪B| (0 when either empty). */
export function tokenSimilarity(
  a: readonly string[],
  b: readonly string[],
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let intersection = 0;
  for (const token of a) if (setB.has(token)) intersection += 1;
  const union = a.length + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Builds the price book from raw reference lines. Each entry is tokenized ONCE
 * so matching N target lines against M references stays cheap. Lines with no
 * usable price or an empty token set (pure stop-words) are dropped.
 */
export function buildPriceBook(
  refs: readonly ReferenceBpuLine[],
): PriceBookEntry[] {
  const book: PriceBookEntry[] = [];
  for (const ref of refs) {
    const price = ref.prixUnitaireMad;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    const tokens = tokenizeDesignation(ref.designation);
    if (tokens.length === 0) continue;
    book.push({ tokens, unite: normalizeUnit(ref.unite), prixUnitaireMad: price });
  }
  return book;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Finds the best historical price for one line: scores every book entry by token
 * similarity (penalizing a unit mismatch), keeps those above MIN_MATCH_SCORE, and
 * returns the MEDIAN price of the top matches so a single mis-priced reference
 * can't skew the anchor. Null when nothing clears the bar.
 */
export function matchPriceBook(
  designation: string,
  unite: string | null | undefined,
  book: readonly PriceBookEntry[],
): { prixUnitaireMad: number; score: number } | null {
  const tokens = tokenizeDesignation(designation);
  if (tokens.length === 0 || book.length === 0) return null;
  const targetUnit = normalizeUnit(unite);

  const scored: Array<{ price: number; score: number }> = [];
  for (const entry of book) {
    let score = tokenSimilarity(tokens, entry.tokens);
    if (score <= 0) continue;
    if (targetUnit && entry.unite && targetUnit !== entry.unite) {
      score *= UNIT_MISMATCH_FACTOR;
    }
    if (score >= MIN_MATCH_SCORE) {
      scored.push({ price: entry.prixUnitaireMad, score });
    }
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, MATCH_POOL);
  return {
    prixUnitaireMad: median(pool.map((m) => m.price)),
    score: pool[0]!.score,
  };
}

export interface ResolveInput {
  /** One entry per BPU line: the DCE's own unit price, or null when absent. */
  dcePrices: ReadonlyArray<number | null>;
  designations: readonly string[];
  unites: ReadonlyArray<string | null | undefined>;
  priceBook: readonly PriceBookEntry[];
}

/**
 * Resolves every BPU line to its best REFERENCE price, best-first: the DCE's own
 * estimatif, then the learned price book. Lines neither can price come back as
 * 'aucune' (source null) — the caller sends only those to the LLM.
 */
export function resolveReferencePrices(
  input: ResolveInput,
): ResolvedUnitPrice[] {
  const { dcePrices, designations, unites, priceBook } = input;
  return designations.map((designation, i) => {
    const dce = dcePrices[i];
    if (typeof dce === 'number' && Number.isFinite(dce) && dce > 0) {
      return { prixUnitaireMad: dce, source: 'dce', score: 1 };
    }
    const match = matchPriceBook(designation, unites[i], priceBook);
    if (match) {
      return {
        prixUnitaireMad: match.prixUnitaireMad,
        source: 'historique',
        score: match.score,
      };
    }
    return { prixUnitaireMad: null, source: 'aucune', score: 0 };
  });
}

/** Tallies where each line's price came from — surfaced for audit + the UI. */
export function summarizeBasis(
  resolved: readonly ResolvedUnitPrice[],
): PricingBasis {
  const basis: PricingBasis = { dce: 0, historique: 0, ia: 0, aucune: 0 };
  for (const line of resolved) basis[line.source] += 1;
  return basis;
}

/**
 * Builds a compact anchor block for the LLM: the reference prices we already
 * resolved, so when the model prices the remaining lines it stays coherent with
 * the real ones instead of inventing a disconnected scale. Capped to keep the
 * prompt bounded on large bordereaux.
 */
export function buildReferenceHints(
  designations: readonly string[],
  resolved: readonly ResolvedUnitPrice[],
  maxHints: number,
): string {
  const hints: string[] = [];
  for (let i = 0; i < designations.length && hints.length < maxHints; i++) {
    const line = resolved[i];
    if (!line || line.prixUnitaireMad === null || line.source === 'ia') continue;
    const tag = line.source === 'dce' ? 'estimatif DCE' : 'référence marché';
    hints.push(
      `- "${designations[i]}" ≈ ${line.prixUnitaireMad} MAD (${tag})`,
    );
  }
  return hints.join('\n');
}
