import { parseMoneyMad } from './detail.parser';

/**
 * Stage-3b acquisition — "Suivre la commission" (Atexo MPE SuiviConsultation).
 *
 * Once a consultation's deadline passes and the commission opens the envelopes,
 * the portal publishes, per (refConsultation, orgAcronyme), a STRUCTURED HTML
 * table of every soumissionnaire with their admissibility (administrative +
 * financial envelope) and their bid amount — Avant / Après Correction. This is
 * the full competitor field + prices WITHOUT any OCR or LLM (unlike the scanned
 * PV notice pv.parser reads), the same source datao's "Résultats" (Adjudicataire
 * + Budget) is built from. We parse it directly and store each bidder as a
 * competitor_bid scoped to the tender's reference + buyer.
 *
 * The definitive attributaire is not always flagged in this view; for a price
 * driven appel d'offres the retained bidder is the lowest ADMISSIBLE offer
 * (moins-disant), which we surface as the presumptive winner. The scanned
 * "Résultat définitif" notice (annonceType=4) can refine it later.
 */

export interface SuiviBidder {
  /** Raison sociale of the soumissionnaire. */
  entreprise: string;
  /** Administrative envelope admissible (not "Écartée"). */
  admissibleAdmin: boolean;
  /** Financial envelope admissible (not "Fermée"/"Écartée"). */
  admissibleFinance: boolean;
  /** In the running: both envelopes admissible. */
  admissible: boolean;
  /** Offer amount (MAD) — Après Correction preferred, else Avant, else null. */
  amountMad: number | null;
}

export interface SuiviCommission {
  bidders: SuiviBidder[];
  /** Presumptive attributaire = lowest admissible amount (moins-disant), or null. */
  winner: SuiviBidder | null;
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'https://www.marchespublics.gov.ma';
  }
}

/** Canonical "Suivre la commission" URL for a consultation. */
export function buildSuiviUrl(
  refConsultation: string,
  orgAcronyme: string,
  origin: string,
): string {
  return `${originOf(origin)}/?page=entreprise.SuiviConsultation&refConsultation=${refConsultation}&orgAcronyme=${orgAcronyme}`;
}

/** Extract (refConsultation, orgAcronyme) from any detail/consultation URL. */
export function refOrgFromUrl(
  url: string,
): { refConsultation: string; orgAcronyme: string } | null {
  const ref = /refConsultation=(\d+)/.exec(url)?.[1];
  const org = /orgAcronyme=([A-Za-z0-9_]+)/.exec(url)?.[1];
  return ref && org ? { refConsultation: ref, orgAcronyme: org } : null;
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

/** True when a status word means the envelope is admissible (in the running). */
function isAdmissible(status: string): boolean {
  return /admissible/i.test(status) && !/non\s*admissible|écart|ecart/i.test(status);
}

/**
 * The commission results table (`table-results`, header "Entreprise"). Isolate
 * it, then read each tbody row's cells: name (in an <h3>), admin status, finance
 * status, Avant Correction, Après Correction (last two cells).
 */
export function parseSuiviCommission(html: string): SuiviCommission {
  const tableBody = [
    ...html.matchAll(
      /<table[^>]*class="[^"]*table-results[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    ),
  ]
    .map((m) => m[1] ?? '')
    .find((body) => /Entreprise/i.test(body) && /Financi/i.test(body));
  if (!tableBody) return { bidders: [], winner: null };

  const tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableBody)?.[1] ?? tableBody;
  const bidders: SuiviBidder[] = [];
  for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1] ?? '';
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      cellText(c[1] ?? ''),
    );
    if (cells.length < 3) continue; // header / spacer rows carry no <td> field set
    const entreprise = cells[0] ?? '';
    if (!entreprise) continue;
    const admissibleAdmin = isAdmissible(cells[1] ?? '');
    const admissibleFinance = isAdmissible(cells[2] ?? '');
    // Après Correction (last cell) wins; fall back to Avant Correction.
    const amountMad =
      parseMoneyMad(cells[cells.length - 1]) ??
      parseMoneyMad(cells[cells.length - 2] ?? '');
    bidders.push({
      entreprise,
      admissibleAdmin,
      admissibleFinance,
      admissible: admissibleAdmin && admissibleFinance,
      amountMad,
    });
  }

  // Presumptive winner = lowest admissible offer with a known amount (moins-disant).
  const priced = bidders.filter(
    (b): b is SuiviBidder & { amountMad: number } =>
      b.admissible && typeof b.amountMad === 'number',
  );
  const winner =
    priced.length > 0
      ? priced.reduce((lo, b) => (b.amountMad < lo.amountMad ? b : lo))
      : null;

  return { bidders, winner };
}
