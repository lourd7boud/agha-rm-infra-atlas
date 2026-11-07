/**
 * Commercial / Ventes division — pure document arithmetic shared by devis
 * (quotes) and factures (invoices): per-line totals and the HT / TVA / TTC
 * roll-up. No I/O, no Drizzle — the repository folds these on create so both
 * the InMemory and Drizzle implementations persist identical figures.
 */

export type QuoteStatus =
  | 'brouillon'
  | 'envoye'
  | 'accepte'
  | 'refuse'
  | 'expire';

export type DeliveryNoteStatus = 'brouillon' | 'livre';

export type InvoiceStatus = 'brouillon' | 'envoyee' | 'payee' | 'annulee';

/** A priced line — the unit shared by quote_line and invoice_line. */
export interface DocLine {
  quantity: number;
  unitPriceMad: number;
}

export interface DocTotals {
  totalHtMad: number;
  tvaMad: number;
  totalTtcMad: number;
}

/** Round to 2 decimals (centimes), guarding against binary-float drift. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Line total = quantity × unit price, rounded to 2 decimals. */
export function lineTotal(line: DocLine): number {
  return round2(line.quantity * line.unitPriceMad);
}

/**
 * HT / TVA / TTC for a document: HT is the sum of rounded line totals, TVA is
 * HT × tvaPct/100, TTC is HT + TVA — each rounded to 2 decimals. Used for both
 * quote and invoice creation.
 */
export function computeDocTotals(
  lines: readonly DocLine[],
  tvaPct: number,
): DocTotals {
  const totalHtMad = round2(
    lines.reduce((sum, line) => sum + lineTotal(line), 0),
  );
  const tvaMad = round2((totalHtMad * tvaPct) / 100);
  const totalTtcMad = round2(totalHtMad + tvaMad);
  return { totalHtMad, tvaMad, totalTtcMad };
}

// ── Legal sequential numbering (art. 145 CGI) ─────────────────────────────────
// The Moroccan tax code requires invoice numbering to be sequential, chronological
// and continuous (no gaps, each number used once). Numbers must therefore be
// assigned SERVER-SIDE, never typed by the user. Devis / BL follow the same shape
// for consistency, though only the facture is legally binding.

/** The four sales document kinds that carry a numbered reference. */
export type DocType = 'facture' | 'devis' | 'bl' | 'avoir';

/** Reference prefix per document kind (FAC-2026-0001, DEV-…, BL-…, AV-…). */
export const DOC_PREFIX: Record<DocType, string> = {
  facture: 'FAC',
  devis: 'DEV',
  bl: 'BL',
  avoir: 'AV',
};

/** Number of zero-padded digits in the per-exercice counter (e.g. 000001). */
const SEQ_PAD = 6;

/**
 * Fiscal year (exercice) a document belongs to — the calendar year of its date.
 * Read in UTC to match how `date` columns round-trip (midnight-Z), so a document
 * dated 2026-01-01 never slips into 2025 under a negative-offset timezone.
 */
export function docExercice(date: Date): number {
  return date.getUTCFullYear();
}

/**
 * Legal sequential reference for a sales document. Format:
 * `${PREFIX}-${exercice}-${NNNN}` (e.g. `FAC-2026-0001`). `seq` is the 1-based
 * counter value produced atomically by the repository inside the insert
 * transaction, so the sequence is gap-free per (docType, exercice).
 */
export function formatDocReference(
  docType: DocType,
  exercice: number,
  seq: number,
): string {
  return `${DOC_PREFIX[docType]}-${exercice}-${String(seq).padStart(SEQ_PAD, '0')}`;
}
