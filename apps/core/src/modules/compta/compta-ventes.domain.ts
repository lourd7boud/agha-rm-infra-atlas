/**
 * Pure builder — a confirmed sales invoice → its double-entry SALE écriture
 * (journal VTE), per the Moroccan CGNC standard:
 *   D 3421  Clients ............................ TTC
 *   C 71242 Travaux facturés clients privés .... HT
 *   C 4455  État, TVA facturée ................. TVA (only when > 0)
 * No I/O: the repository persists the returned écriture, stamps `source='vente'`
 * and the invoice id, and (when `certaine`) auto-validates it — so the accountant
 * only supervises. Keeping this out of the repository makes the mapping auditable
 * and unit-testable without a database.
 */

/** CGNC accounts used by the sale entry — named so the mapping is auditable, not
 *  a scatter of string literals. Validated against `compta.compte` at write time. */
export const VENTE_COMPTE_CLIENT = '3421';
export const VENTE_COMPTE_PRODUIT = '71242';
export const VENTE_COMPTE_TVA = '4455';

/** Journal des ventes. */
export const VENTE_JOURNAL = 'VTE';

/** One accounting line — structurally the repository's LigneInput. */
export interface VenteEcritureLigne {
  compteCode: string;
  debit: number;
  credit: number;
  tiers?: string;
}

/**
 * Why a single auto-post attempt did (or did not) create an écriture. Returned to
 * the caller so nothing is silent: `incoherent` / `exercice_cloture` are the
 * "should have posted but couldn't" cases a human must see; the rest are benign
 * no-ops. (Zero-omission requirement — art. 145 / user goal.)
 */
export type VentePostingReason =
  | 'posted' // a new écriture was created
  | 'already_posted' // an écriture already existed for this invoice
  | 'raced' // a concurrent confirmation created it first (idempotent)
  | 'still_draft' // invoice is still 'brouillon' — nothing to post yet
  | 'not_paid' // invoice isn't paid yet — no encaissement to post
  | 'not_found' // invoice id unknown
  | 'incoherent' // totals don't make a valid entry (needs human attention)
  | 'exercice_cloture' // the invoice's fiscal year is closed (needs human action)
  | 'error'; // an unexpected failure occurred (needs human attention)

export interface VentePostingResult {
  created: boolean;
  ecritureId?: string;
  validated?: boolean;
  reason: VentePostingReason;
}

/** The reasons that mean an expected écriture was NOT produced — a human must act. */
export const VENTE_POSTING_NEEDS_ATTENTION: readonly VentePostingReason[] = [
  'incoherent',
  'exercice_cloture',
  'error',
];

/** The minimal invoice facts the sale entry is built from. */
export interface VenteSource {
  reference: string;
  clientName: string;
  totalHtMad: number;
  totalTtcMad: number;
}

export interface VenteEcriture {
  journalCode: typeof VENTE_JOURNAL;
  pieceRef: string;
  libelle: string;
  lignes: VenteEcritureLigne[];
  tvaMad: number;
  /** True when the mapping is unambiguous and the entry balances → safe to
   *  auto-validate. False → post as brouillon for the accountant to review. */
  certaine: boolean;
}

/** Round to 2 decimals (centimes), guarding against binary-float drift. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Build the sale écriture for an invoice, or `null` when the figures are
 * incoherent and must NOT post automatically (non-positive TTC, negative HT, or
 * HT above TTC → impossible TVA). A coherent invoice always balances (TTC = HT +
 * TVA); `certaine` additionally requires a named tiers so a blank client falls
 * back to review rather than silent auto-validation.
 */
export function buildVenteEcriture(src: VenteSource): VenteEcriture | null {
  const ht = round2(src.totalHtMad);
  const ttc = round2(src.totalTtcMad);
  const tva = round2(ttc - ht);
  if (ttc <= 0 || ht < 0 || ht > ttc) return null;

  const lignes: VenteEcritureLigne[] = [
    { compteCode: VENTE_COMPTE_CLIENT, debit: ttc, credit: 0, tiers: src.clientName },
    { compteCode: VENTE_COMPTE_PRODUIT, debit: 0, credit: ht },
  ];
  if (tva > 0) lignes.push({ compteCode: VENTE_COMPTE_TVA, debit: 0, credit: tva });

  const totalDebit = round2(lignes.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(lignes.reduce((sum, l) => sum + l.credit, 0));
  const certaine =
    src.clientName.trim().length > 0 && totalDebit === totalCredit && totalDebit > 0;

  return {
    journalCode: VENTE_JOURNAL,
    pieceRef: src.reference,
    libelle: `Facture ${src.reference} — ${src.clientName}`,
    lignes,
    tvaMad: tva,
    certaine,
  };
}
