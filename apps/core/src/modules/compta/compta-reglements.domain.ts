/**
 * Pure builder — a paid invoice → its ENCAISSEMENT (client règlement) écriture,
 * under the RÉGIME DE L'ENCAISSEMENT. Compound entry:
 *   D 514x / 516x  Trésorerie (banque / caisse) .... montant reçu (TTC)
 *   C 3421         Clients ......................... montant reçu (TTC)
 *   D 4455         État, TVA facturée .............. TVA  (transfer out of "en attente")
 *   C 4456         État, TVA due ................... TVA  (now exigible → declared)
 * The first pair clears the client receivable opened by the sale écriture; the
 * second pair shifts the TVA from "facturée" (4455, pending) to "due" (4456) so the
 * TVA declaration — which reads 4456 by écriture date — only picks up TVA actually
 * COLLECTED in the period (art. 95 CGI, régime de l'encaissement, favorable au BTP).
 * Journal BQ (banque) or CAI (caisse) per the payment method. No I/O: the repository
 * persists the entry, stamps source='reglement' + the invoice id, and (when
 * `certaine`) auto-validates it.
 */
import {
  VENTE_COMPTE_CLIENT,
  VENTE_COMPTE_TVA,
  type VenteEcritureLigne,
} from './compta-ventes.domain';

/** CGNC account where TVA becomes exigible/declarable once collected. */
export const REGLEMENT_COMPTE_TVA_DUE = '4456';

/** How the client settled — drives the trésorerie account + journal. */
export type ReglementMethod = 'virement' | 'cheque' | 'espece' | 'carte';

/** Payment method → CGNC trésorerie account + journal. Bank for everything except
 *  cash (caisse). Mirrors the DEPENSE_CONTREPARTIES mapping already in the repo. */
export const REGLEMENT_TRESORERIE: Record<
  ReglementMethod,
  { compte: string; journal: string }
> = {
  virement: { compte: '5141', journal: 'BQ' },
  cheque: { compte: '5141', journal: 'BQ' },
  carte: { compte: '5141', journal: 'BQ' },
  espece: { compte: '5161', journal: 'CAI' },
};

/** Default when the UI doesn't specify a method (most common B2B settlement). */
export const DEFAULT_REGLEMENT_METHOD: ReglementMethod = 'virement';

export interface EncaissementSource {
  reference: string;
  clientName: string;
  montantTtc: number;
  /** TVA portion of the collected amount — transferred 4455→4456 (exigibility). */
  tvaMad: number;
  method?: ReglementMethod;
}

export interface EncaissementEcriture {
  journalCode: string;
  pieceRef: string;
  libelle: string;
  lignes: VenteEcritureLigne[];
  certaine: boolean;
}

/** Round to 2 decimals (centimes), guarding against binary-float drift. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Build the encaissement écriture for a paid invoice, or `null` when there is
 * nothing to collect (non-positive amount). Balanced by construction (D = C =
 * montant). `certaine` requires a named tiers so a blank client falls back to
 * review rather than silent auto-validation.
 */
export function buildEncaissementEcriture(
  src: EncaissementSource,
): EncaissementEcriture | null {
  const montant = round2(src.montantTtc);
  if (montant <= 0) return null;
  const tva = round2(src.tvaMad);

  const method = src.method ?? DEFAULT_REGLEMENT_METHOD;
  const { compte, journal } = REGLEMENT_TRESORERIE[method];
  const lignes: VenteEcritureLigne[] = [
    { compteCode: compte, debit: montant, credit: 0 },
    { compteCode: VENTE_COMPTE_CLIENT, debit: 0, credit: montant, tiers: src.clientName },
  ];
  // Régime de l'encaissement: the TVA becomes exigible now (at collection) —
  // transfer it from 4455 (facturée, pending) to 4456 (due) so the declaration
  // picks it up in the collection period, not at invoicing. Skipped when TVA = 0.
  if (tva > 0) {
    lignes.push({ compteCode: VENTE_COMPTE_TVA, debit: tva, credit: 0 });
    lignes.push({ compteCode: REGLEMENT_COMPTE_TVA_DUE, debit: 0, credit: tva });
  }
  const certaine = src.clientName.trim().length > 0 && montant > 0;

  return {
    journalCode: journal,
    pieceRef: src.reference,
    libelle: `Encaissement ${src.reference} — ${src.clientName}`,
    lignes,
    certaine,
  };
}
