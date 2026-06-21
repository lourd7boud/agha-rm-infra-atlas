import { fmtMad } from './projects';

/**
 * Commercial / Ventes division — frontend mirror of the @atlas/core sales module
 * contract (apps/core/src/modules/sales). Money/quantities arrive as numbers
 * (the repository surfaces the Postgres numeric strings as numbers); MAD
 * formatting reuses fmtMad. Status unions mirror sales.domain so the page-level
 * filters and the persisted values share one vocabulary.
 */

// ── Clients ────────────────────────────────────────────────────────────────

export type ClientStatus = 'actif' | 'inactif';

export interface ClientRecord {
  id: string;
  name: string;
  ice?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  status: ClientStatus;
  notes?: string;
  createdAt: string;
}

/** Client status → French label + badge classes (mirrors the doc badge maps). */
export const CLIENT_STATUS_BADGES: Record<
  ClientStatus,
  { label: string; classes: string }
> = {
  actif: { label: 'Actif', classes: 'bg-emerald-soft text-emerald' },
  inactif: { label: 'Inactif', classes: 'bg-sand text-faint' },
};

// ── Priced line (devis + facture) ────────────────────────────────────────────

export interface DocLineRecord {
  id: string;
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  lineTotalMad: number;
  orderIndex: number;
}

// ── Quotes / devis ────────────────────────────────────────────────────────────

export type QuoteStatus =
  | 'brouillon'
  | 'envoye'
  | 'accepte'
  | 'refuse'
  | 'expire';

export interface QuoteRecord {
  id: string;
  clientId: string;
  projectId?: string;
  reference: string;
  objet?: string;
  status: QuoteStatus;
  quoteDate: string;
  validUntil?: string;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  notes?: string;
  createdAt: string;
  lines: DocLineRecord[];
}

export const QUOTE_STATUS_BADGES: Record<
  QuoteStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  envoye: { label: 'Envoyé', classes: 'bg-cyan-soft text-cyan' },
  accepte: { label: 'Accepté', classes: 'bg-emerald-soft text-emerald' },
  refuse: { label: 'Refusé', classes: 'bg-clay-soft text-clay' },
  expire: { label: 'Expiré', classes: 'bg-sand text-faint' },
};

export const QUOTE_STATUS_OPTIONS: readonly {
  value: QuoteStatus;
  label: string;
}[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'envoye', label: 'Envoyé' },
  { value: 'accepte', label: 'Accepté' },
  { value: 'refuse', label: 'Refusé' },
  { value: 'expire', label: 'Expiré' },
];

// ── Delivery notes / bons de livraison ───────────────────────────────────────

export type DeliveryNoteStatus = 'brouillon' | 'livre';

export interface DeliveryLineRecord {
  id: string;
  designation: string;
  quantity: number;
  unit?: string;
  orderIndex: number;
}

export interface DeliveryNoteRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string;
  deliveryDate: string;
  status: DeliveryNoteStatus;
  notes?: string;
  createdAt: string;
  lines: DeliveryLineRecord[];
}

export const DELIVERY_STATUS_BADGES: Record<
  DeliveryNoteStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  livre: { label: 'Livré', classes: 'bg-emerald-soft text-emerald' },
};

export const DELIVERY_STATUS_OPTIONS: readonly {
  value: DeliveryNoteStatus;
  label: string;
}[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'livre', label: 'Livré' },
];

// ── Invoices / factures ──────────────────────────────────────────────────────

export type InvoiceStatus = 'brouillon' | 'envoyee' | 'payee' | 'annulee';

export interface InvoiceRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string;
  invoiceDate: string;
  dueDate?: string;
  status: InvoiceStatus;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  paidAt?: string;
  notes?: string;
  createdAt: string;
  lines: DocLineRecord[];
}

export const INVOICE_STATUS_BADGES: Record<
  InvoiceStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  envoyee: { label: 'Envoyée', classes: 'bg-cyan-soft text-cyan' },
  payee: { label: 'Payée', classes: 'bg-emerald-soft text-emerald' },
  annulee: { label: 'Annulée', classes: 'bg-clay-soft text-clay' },
};

export const INVOICE_STATUS_OPTIONS: readonly {
  value: InvoiceStatus;
  label: string;
}[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'envoyee', label: 'Envoyée' },
  { value: 'payee', label: 'Payée' },
  { value: 'annulee', label: 'Annulée' },
];

// ── Aliases ────────────────────────────────────────────────────────────────
// Short, domain-facing names for the records above. The `*Record` names stay
// canonical (mirroring the @atlas/core repository types); these aliases let the
// sales pages read as Client / Quote / QuoteLine / Invoice / DeliveryNote.

export type Client = ClientRecord;
export type QuoteLine = DocLineRecord;
export type Quote = QuoteRecord;
export type DeliveryNote = DeliveryNoteRecord;
export type Invoice = InvoiceRecord;

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Print layout variants shared by the bon de livraison and facture sheets. */
export type PrintFormat = 'detaille' | 'simple';

export function parsePrintFormat(value: string | undefined): PrintFormat {
  return value === 'simple' ? 'simple' : 'detaille';
}

/** Re-export so sales pages import one money formatter. */
export { fmtMad };

/** A quantity, trimmed of trailing zeros and suffixed with its unit. */
export function fmtQtyUnit(quantity: number, unit?: string): string {
  const qty = quantity.toLocaleString('fr-MA', { maximumFractionDigits: 3 });
  return unit ? `${qty} ${unit}` : qty;
}

/** Formats an ISO date string as a Moroccan short date, dash when absent. */
export function fmtDate(value: string | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA');
}

/** TVA amount derived from a document's HT / TTC (avoids re-rounding drift). */
export function tvaMad(doc: { totalHtMad: number; totalTtcMad: number }): number {
  return doc.totalTtcMad - doc.totalHtMad;
}
