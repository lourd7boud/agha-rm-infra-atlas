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
export type ClientType = 'professionnel' | 'particulier';

export interface ClientRecord {
  id: string;
  name: string;
  clientType: ClientType;
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

/** DB-computed client counts over the whole set (paging-independent cards). */
export interface ClientSummary {
  count: number;
  activeCount: number;
}

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
  reference: string | null;
  objet?: string;
  status: QuoteStatus;
  quoteDate: string;
  validUntil?: string;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  notes?: string;
  issuedAt?: string;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
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

/** Quote list row — the record minus its `lines` (the list never renders them). */
export type QuoteListItem = Omit<QuoteRecord, 'lines'>;

/** DB-computed quote totals over the whole filtered set (paging-independent). */
export interface QuoteSummary {
  count: number;
  totalTtcMad: number;
}

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
  reference: string | null;
  deliveryDate: string;
  status: DeliveryNoteStatus;
  notes?: string;
  issuedAt?: string;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
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

/** Delivery-note list row — the record minus `lines`, carrying only the line
 *  count the list column renders. */
export type DeliveryNoteListItem = Omit<DeliveryNoteRecord, 'lines'> & {
  lineCount: number;
};

// ── Invoices / factures ──────────────────────────────────────────────────────

export type InvoiceLifecycle = 'brouillon' | 'emise' | 'annulee';
export type InvoiceStatus = InvoiceLifecycle | 'envoyee' | 'payee';
export type InvoiceSettlementState =
  | 'non_reglee'
  | 'partiellement_payee'
  | 'payee'
  | 'solde_crediteur'
  | 'remboursee';
export type AccountingProjectionStatus = 'pending' | 'projected' | 'blocked';

export interface LegalSellerSnapshot {
  legalName: string;
  address: string;
  ice: string;
  taxId: string;
  tradeRegister: string;
  professionalTaxId?: string;
  client?: LegalClientSnapshot;
}

export interface LegalClientSnapshot {
  name: string;
  clientType: ClientType;
  address?: string;
  city?: string;
  ice?: string;
}

export interface InvoiceRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string | null;
  invoiceDate: string;
  dueDate?: string;
  status: InvoiceStatus;
  totalHtMad: number;
  tvaPct: number;
  tvaMad: number;
  totalTtcMad: number;
  paidAt?: string;
  notes?: string;
  paymentTerms?: string;
  issuedAt?: string;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
  legacyPaid: boolean;
  createdAt: string;
  lines: DocLineRecord[];
}

export interface InvoicePaymentRecord {
  id: string;
  invoiceId: string;
  movementType: 'encaissement' | 'remboursement';
  amountCents: number;
  method: string;
  treasuryAccount: string;
  valueDate: string;
  originalMovementId?: string;
  creditNoteId?: string;
  reference?: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export interface CreditNoteRecord {
  id: string;
  invoiceId: string;
  reference: string | null;
  status: InvoiceLifecycle;
  creditDate: string;
  totalHtCents: number;
  tvaCents: number;
  totalTtcCents: number;
  againstOutstandingCents: number;
  againstCollectedCents: number;
  reason: string;
  issuedAt?: string;
  issuedBy?: string;
  version: number;
  createdBy: string;
  createdAt: string;
}

export interface SettlementSummary {
  state: InvoiceSettlementState;
  netInvoiceCents: number;
  netReceivedCents: number;
  outstandingCents: number;
  customerCreditCents: number;
}

export interface InvoiceAggregate {
  invoice: InvoiceRecord;
  payments: InvoicePaymentRecord[];
  creditNotes: CreditNoteRecord[];
  settlement: SettlementSummary;
  accountingProjection: AccountingProjectionStatus;
  legacyPaidOpening: boolean;
}

/** One page of results plus the total matching count (mirrors core Paged<T>). */
export interface Paged<T> {
  items: T[];
  total: number;
}

/** Invoice list row — the record minus its `lines` (the list never renders them). */
export type InvoiceListItem = Omit<InvoiceRecord, 'lines'>;

/** DB-computed invoice totals over the whole filtered set (paging-independent). */
export interface InvoiceSummary {
  count: number;
  totalTtcMad: number;
  outstandingTtcMad: number;
}

export const INVOICE_STATUS_BADGES: Record<
  InvoiceStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  emise: { label: 'Émise', classes: 'bg-cyan-soft text-cyan' },
  envoyee: { label: 'Envoyée', classes: 'bg-cyan-soft text-cyan' },
  payee: { label: 'Payée', classes: 'bg-emerald-soft text-emerald' },
  annulee: { label: 'Annulée', classes: 'bg-clay-soft text-clay' },
};

export const INVOICE_STATUS_OPTIONS: readonly {
  value: InvoiceStatus;
  label: string;
}[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'emise', label: 'Émise' },
  { value: 'envoyee', label: 'Envoyée' },
  { value: 'payee', label: 'Payée' },
  { value: 'annulee', label: 'Annulée' },
];

export const INVOICE_SETTLEMENT_BADGES: Record<
  InvoiceSettlementState,
  { label: string; classes: string }
> = {
  non_reglee: { label: 'Non réglée', classes: 'bg-sand text-muted' },
  partiellement_payee: {
    label: 'Partiellement payée',
    classes: 'bg-ochre-soft text-ochre',
  },
  payee: { label: 'Payée', classes: 'bg-emerald-soft text-emerald' },
  solde_crediteur: {
    label: 'Solde créditeur',
    classes: 'bg-cyan-soft text-cyan',
  },
  remboursee: { label: 'Remboursée', classes: 'bg-sand text-faint' },
};

export const ACCOUNTING_PROJECTION_BADGES: Record<
  AccountingProjectionStatus,
  { label: string; classes: string }
> = {
  pending: { label: 'Comptabilisation en attente', classes: 'bg-sand text-muted' },
  projected: {
    label: 'Projetée en comptabilité',
    classes: 'bg-emerald-soft text-emerald',
  },
  blocked: {
    label: 'Comptabilisation bloquée',
    classes: 'bg-clay-soft text-clay',
  },
};

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

const centsFormatter = new Intl.NumberFormat('fr-MA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtCentsMad(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Le montant doit être un entier sûr en centimes.');
  }
  return `${centsFormatter.format(cents / 100)} MAD`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertSafeCents(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Agrégat de facture invalide: ${field}.`);
  }
}

export function parseInvoiceAggregate(value: unknown): InvoiceAggregate {
  if (!isObject(value)) throw new Error('Agrégat de facture invalide.');
  if (
    !isObject(value.invoice) ||
    !Array.isArray(value.payments) ||
    !Array.isArray(value.creditNotes) ||
    !isObject(value.settlement) ||
    typeof value.legacyPaidOpening !== 'boolean'
  ) {
    throw new Error('Agrégat de facture incomplet.');
  }
  const projection = value.accountingProjection;
  if (!['pending', 'projected', 'blocked'].includes(String(projection))) {
    throw new Error('Projection comptable invalide.');
  }
  const state = value.settlement.state;
  if (
    ![
      'non_reglee',
      'partiellement_payee',
      'payee',
      'solde_crediteur',
      'remboursee',
    ].includes(String(state))
  ) {
    throw new Error('Agrégat de facture invalide: état de règlement.');
  }
  for (const field of [
    'netInvoiceCents',
    'netReceivedCents',
    'outstandingCents',
    'customerCreditCents',
  ] as const) {
    assertSafeCents(value.settlement[field], field);
  }
  return value as unknown as InvoiceAggregate;
}
