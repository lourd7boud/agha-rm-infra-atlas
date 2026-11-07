import { parseMoneyMad, parseReferentielEstimation } from './detail.parser';
import { refOrgFromUrl, buildSuiviUrl } from './suivi.parser';

/**
 * "Analyse du résultat" — marchecal-style winner / prix-de-référence engine.
 *
 * marchecal.com/analyse.php takes a marchespublics.gov.ma SuiviConsultation URL
 * and, from the published "Suivre la commission" dépouillement, computes for each
 * lot the winning company, the winning price and the Moroccan "prix de référence".
 * We reproduce that computation INSIDE ATLAS so a tender drawer can answer
 * "qui a gagné, à quel prix, vs l'estimation du maître d'ouvrage" in one click,
 * without the operator copy-pasting a portal URL into a third-party site.
 *
 * Reverse-engineered + validated against the live portal (refConsultation
 * 1036844, estimation 420 000 MAD, 7 priced admissible offers):
 *
 *   eligible      = admissible offers with a price ≤ estimation MO
 *   moyenne       = mean(eligible)
 *   prixReférence = (estimation + moyenne) / 2
 *                   = (420 000 + 416 125,71) / 2 = 418 062,86  (matches marchecal)
 *   gagnant       = the admissible offer closest BELOW the prix de référence
 *                   (411 600 → FCI-DEVELOPPEMENT), NOT the absolute lowest
 *                   (403 200 DIRASSAT is below-reference too but farther → écartée
 *                   as presumptively "anormalement basse").
 *   diff vs MO    = (offre − estimation) / estimation × 100   (e.g. −2 %)
 *
 * Pure functions only — no I/O — so the whole computation is unit-testable.
 */

export interface AnalyseBidder {
  /** Raison sociale du soumissionnaire. */
  entreprise: string;
  /** Enveloppe administrative, raw portal label ("Admissible" / "Ecartée"…). */
  adminStatus: string;
  /**
   * Financial-gate label exactly as marchecal surfaces it under "Statut Fin":
   * the second status column of the dépouillement row. On the current portal
   * layout that column is the technical envelope (écartée ⇒ financial envelope
   * never opened), which is what blocks the bid — hence marchecal prints it.
   */
  finStatus: string;
  /** Montant "Avant Correction" (MAD). */
  avantMad: number | null;
  /** Montant "Après Correction" (MAD). */
  apresMad: number | null;
  /** Retained offer amount: Après Correction preferred, else Avant. */
  amountMad: number | null;
  /** Both envelopes admissible (in the running for the price comparison). */
  admissible: boolean;
  /** (offre − estimation) / estimation × 100, 2 decimals. null without price/MO. */
  diffVsMoPct: number | null;
}

export interface AnalyseLot {
  /** "Lot unique" for a single-table dépouillement, else "Lot 1", "Lot 2"… */
  name: string;
  bidders: AnalyseBidder[];
  /** Estimation du maître d'ouvrage used for this lot (MAD), if known. */
  estimationMad: number | null;
  /** Prix de référence = (estimation + moyenne des offres ≤ estimation) / 2. */
  referencePrice: number | null;
  /** Presumptive winner: admissible offer closest below the prix de référence. */
  winner: AnalyseBidder | null;
  /** Winning price (winner.amountMad). */
  winningAmount: number | null;
  /** (prixGagnant − estimation) / estimation × 100. */
  diffWinnerVsMoPct: number | null;
  /** (prixGagnant − prixRéférence) / prixRéférence × 100. */
  diffWinnerVsRefPct: number | null;
}

export interface SuiviAnalyse {
  /** true when a dépouillement table was found on the page at all. */
  hasResults: boolean;
  /** Estimation MO read from the suivi page (referentiel repeater). */
  estimationMad: number | null;
  lots: AnalyseLot[];
}

/** Round to 2 decimals (marchecal prints −0.29 %, −1.55 %). */
function pct2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Diff of `amount` vs a `base` reference as a signed % (2 decimals). */
function diffPct(amount: number, base: number): number | null {
  if (!Number.isFinite(base) || base === 0) return null;
  return pct2(((amount - base) / base) * 100);
}

/** True when a status word means the envelope is admissible (in the running). */
function isAdmissible(status: string): boolean {
  return /admissible/i.test(status) && !/non\s*admissible|écart|ecart/i.test(status);
}

/** Strip tags + decode the small entity set + collapse whitespace + trim. */
function cellText(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse ONE dépouillement `table-results` body into rich bidders. The row cells
 * are read positionally, mirroring both the legacy 5-column layout
 * (Entreprise, Admin, Finance, Avant, Après) and the current 6-column layout
 * (Entreprise, Admin, Technique, Finance, Avant, Après): we keep cells[1] as the
 * administrative status and cells[2] as the marchecal "Statut Fin" label, and the
 * two amounts from the LAST two cells (Avant then Après Correction) either way.
 */
function parseBidders(tableBody: string): AnalyseBidder[] {
  const tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableBody)?.[1] ?? tableBody;
  const bidders: AnalyseBidder[] = [];
  for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1] ?? '';
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      cellText(c[1] ?? ''),
    );
    if (cells.length < 3) continue; // header / spacer rows carry no <td> field set
    const entreprise = cells[0] ?? '';
    if (!entreprise) continue;
    const adminStatus = cells[1] ?? '';
    const finStatus = cells[2] ?? '';
    // Amounts are always the last two cells (Avant Correction, Après Correction).
    const apresMad = parseMoneyMad(cells[cells.length - 1]);
    const avantMad = parseMoneyMad(cells[cells.length - 2] ?? '');
    const amountMad = apresMad ?? avantMad;
    bidders.push({
      entreprise,
      adminStatus,
      finStatus,
      avantMad,
      apresMad,
      amountMad,
      admissible: isAdmissible(adminStatus) && isAdmissible(finStatus),
      diffVsMoPct: null, // filled in once the lot's estimation is known
    });
  }
  return bidders;
}

/**
 * Moroccan "prix de référence": mean of the estimation MO and the arithmetic
 * mean of the admissible offers at or below that estimation. Returns null when
 * the estimation is unknown or no admissible priced offer exists.
 */
export function computeReferencePrice(
  amounts: readonly number[],
  estimationMad: number | null,
): number | null {
  if (estimationMad == null || !Number.isFinite(estimationMad)) return null;
  const eligible = amounts.filter(
    (a) => Number.isFinite(a) && a <= estimationMad,
  );
  if (eligible.length === 0) return null;
  const mean = eligible.reduce((s, a) => s + a, 0) / eligible.length;
  return (estimationMad + mean) / 2;
}

/**
 * Presumptive winner = the admissible offer closest BELOW the prix de référence
 * (the "moins-disant" corrected for presumptively abnormally-low bids). When no
 * reference price is computable, or no offer sits at/below it, fall back to the
 * plain lowest admissible offer (moins-disant).
 */
export function pickWinner(
  bidders: readonly AnalyseBidder[],
  referencePrice: number | null,
): AnalyseBidder | null {
  const priced = bidders.filter(
    (b): b is AnalyseBidder & { amountMad: number } =>
      b.admissible && typeof b.amountMad === 'number',
  );
  if (priced.length === 0) return null;
  if (referencePrice != null) {
    const atOrBelow = priced.filter((b) => b.amountMad <= referencePrice);
    if (atOrBelow.length > 0) {
      return atOrBelow.reduce((hi, b) => (b.amountMad > hi.amountMad ? b : hi));
    }
  }
  return priced.reduce((lo, b) => (b.amountMad < lo.amountMad ? b : lo));
}

/**
 * Parse the full SuiviConsultation page into lots. Each `table-results` block
 * that carries an "Entreprise" + "Financi" header is one lot's dépouillement.
 * The estimation MO (referentiel repeater) applies to every lot on the page.
 */
export function parseSuiviAnalyse(
  html: string,
  estimationOverride?: number | null,
): SuiviAnalyse {
  const estimationMad =
    parseReferentielEstimation(html) ?? estimationOverride ?? null;

  const tables = [
    ...html.matchAll(
      /<table[^>]*class="[^"]*table-results[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    ),
  ]
    .map((m) => m[1] ?? '')
    .filter((body) => /Entreprise/i.test(body) && /Financi/i.test(body));

  const lots: AnalyseLot[] = tables.map((body, idx) => {
    const bidders = parseBidders(body).map((b) => ({
      ...b,
      diffVsMoPct:
        b.amountMad != null && estimationMad != null
          ? diffPct(b.amountMad, estimationMad)
          : null,
    }));
    const amounts = bidders
      .filter((b) => b.admissible && b.amountMad != null)
      .map((b) => b.amountMad as number);
    const referencePrice = computeReferencePrice(amounts, estimationMad);
    const winner = pickWinner(bidders, referencePrice);
    const winningAmount = winner?.amountMad ?? null;
    return {
      name:
        tables.length === 1 ? 'Lot unique' : `Lot ${idx + 1}`,
      bidders,
      estimationMad,
      referencePrice,
      winner,
      winningAmount,
      diffWinnerVsMoPct:
        winningAmount != null && estimationMad != null
          ? diffPct(winningAmount, estimationMad)
          : null,
      diffWinnerVsRefPct:
        winningAmount != null && referencePrice != null
          ? diffPct(winningAmount, referencePrice)
          : null,
    };
  });

  return {
    hasResults: lots.length > 0,
    estimationMad,
    lots,
  };
}

/** Build the canonical suivi URL + refs from a tender's portal sourceUrl. */
export function suiviTargetFromSourceUrl(
  sourceUrl: string,
): { url: string; refConsultation: string; orgAcronyme: string } | null {
  const refs = refOrgFromUrl(sourceUrl);
  if (!refs) return null;
  return {
    url: buildSuiviUrl(refs.refConsultation, refs.orgAcronyme, sourceUrl),
    refConsultation: refs.refConsultation,
    orgAcronyme: refs.orgAcronyme,
  };
}
