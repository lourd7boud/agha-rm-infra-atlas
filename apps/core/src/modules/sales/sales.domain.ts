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
