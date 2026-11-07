/**
 * Commercial / Ventes repository contract — the SALES_REPOSITORY token, the
 * inputs/records shared by the InMemory and Drizzle implementations, and the
 * single repository interface they both satisfy. Money/quantities surface as
 * numbers here (stored as numeric strings in Postgres, like the intel/stock
 * repos). Status unions come from sales.domain so the edge validation and the
 * persisted values share one source of truth.
 */
import type {
  DeliveryNoteStatus,
  InvoiceStatus,
  QuoteStatus,
} from './sales.domain';
import type {
  InvoiceLifecycle,
  SettlementSummary,
} from './sales-invoice.domain';

export interface LegalSellerSnapshot {
  legalName: string;
  address: string;
  ice: string;
  taxId: string;
  tradeRegister: string;
  professionalTaxId?: string;
}

export type AccountingProjectionStatus = 'pending' | 'projected' | 'blocked';

// ── Clients ────────────────────────────────────────────────────────────────

export type ClientStatus = 'actif' | 'inactif';
export type ClientType = 'professionnel' | 'particulier';

export interface UpsertClient {
  name: string;
  clientType?: ClientType;
  ice?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
}

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
  createdAt: Date;
}

// ── Shared priced line (quote + invoice) ──────────────────────────────────────

export interface CreateDocLine {
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  orderIndex?: number;
}

export interface DocLineRecord extends CreateDocLine {
  id: string;
  lineTotalMad: number;
  orderIndex: number;
}

// ── Quotes / devis ────────────────────────────────────────────────────────────

export interface CreateQuote {
  clientId: string;
  projectId?: string;
  objet?: string;
  quoteDate: Date;
  validUntil?: Date;
  tvaPct: number;
  notes?: string;
  lines: CreateDocLine[];
}

export interface QuoteRecord {
  id: string;
  clientId: string;
  projectId?: string;
  reference: string | null;
  objet?: string;
  status: QuoteStatus;
  quoteDate: Date;
  validUntil?: Date;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  notes?: string;
  issuedAt?: Date;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
  createdAt: Date;
  lines: DocLineRecord[];
}

export interface QuoteFilter {
  clientId?: string;
  status?: QuoteStatus;
}

// ── Delivery notes / bons de livraison ───────────────────────────────────────

export interface CreateDeliveryLine {
  designation: string;
  quantity: number;
  unit?: string;
  orderIndex?: number;
}

export interface DeliveryLineRecord extends CreateDeliveryLine {
  id: string;
  orderIndex: number;
}

export interface CreateDeliveryNote {
  clientId: string;
  projectId?: string;
  quoteId?: string;
  deliveryDate: Date;
  notes?: string;
  lines: CreateDeliveryLine[];
}

export interface DeliveryNoteRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string | null;
  deliveryDate: Date;
  status: DeliveryNoteStatus;
  notes?: string;
  issuedAt?: Date;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
  createdAt: Date;
  lines: DeliveryLineRecord[];
}

export interface DeliveryNoteFilter {
  clientId?: string;
  status?: DeliveryNoteStatus;
}

// ── Invoices / factures ──────────────────────────────────────────────────────

export interface CreateInvoice {
  clientId: string;
  projectId?: string;
  quoteId?: string;
  invoiceDate: Date;
  dueDate?: Date;
  tvaPct: number;
  notes?: string;
  lines: CreateDocLine[];
}

export interface InvoiceRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string | null;
  invoiceDate: Date;
  dueDate?: Date;
  status: InvoiceLifecycle | 'envoyee' | 'payee';
  totalHtMad: number;
  tvaPct: number;
  tvaMad: number;
  totalTtcMad: number;
  paidAt?: Date;
  notes?: string;
  paymentTerms?: string;
  issuedAt?: Date;
  issuedBy?: string;
  legalSnapshot?: LegalSellerSnapshot;
  version: number;
  legacyPaid: boolean;
  createdAt: Date;
  lines: DocLineRecord[];
}

export interface InvoiceFilter {
  clientId?: string;
  status?: InvoiceRecord['status'];
}

export interface UpdateInvoiceDraft {
  dueDate?: Date;
  paymentTerms?: string;
  notes?: string;
  version: number;
}

export interface InvoicePaymentRecord {
  id: string;
  invoiceId: string;
  movementType: 'encaissement' | 'remboursement';
  amountCents: number;
  method: string;
  treasuryAccount: string;
  valueDate: Date;
  originalMovementId?: string;
  reference?: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: Date;
}

export interface RecordInvoicePayment {
  invoiceId: string;
  amountCents: number;
  method: string;
  treasuryAccount: string;
  valueDate: Date;
  reference?: string;
  idempotencyKey: string;
  actor: string;
}

export interface ReverseInvoicePayment {
  invoiceId: string;
  paymentId: string;
  valueDate: Date;
  idempotencyKey: string;
  actor: string;
}

export interface CreateCreditNote {
  invoiceId: string;
  creditDate: Date;
  totalHtCents: number;
  tvaCents: number;
  reason: string;
  createdBy: string;
}

export interface CreditNoteRecord {
  id: string;
  invoiceId: string;
  reference: string | null;
  status: InvoiceLifecycle;
  creditDate: Date;
  totalHtCents: number;
  tvaCents: number;
  totalTtcCents: number;
  againstOutstandingCents: number;
  againstCollectedCents: number;
  reason: string;
  issuedAt?: Date;
  issuedBy?: string;
  version: number;
  createdBy: string;
  createdAt: Date;
}

export interface SalesAccountingEventRecord {
  id: string;
  eventKey: string;
  eventType: string;
  sourceId: string;
  sourceVersion: number;
  occurredAt: Date;
  status: AccountingProjectionStatus;
}

export interface InvoiceAggregate {
  invoice: InvoiceRecord;
  payments: InvoicePaymentRecord[];
  creditNotes: CreditNoteRecord[];
  settlement: SettlementSummary;
  accountingProjection: AccountingProjectionStatus;
  legacyPaidOpening: boolean;
}

// ── Pagination (datao-parity: DB-side LIMIT/OFFSET; totals via a summary) ─────

/** DB-side page window. limit is bounded by the controller (default 25/max 100). */
export interface PageParams {
  limit: number;
  offset: number;
}

/** A single page plus the total matching-row count (for the pager). */
export interface Paged<T> {
  items: T[];
  total: number;
}

/** List projection — the invoices table minus the heavy `lines` array (the list
 *  view never renders lines; the detail page still fetches the full record). */
export type InvoiceListItem = Omit<InvoiceRecord, 'lines'>;

/** DB-computed totals over the WHOLE filtered set — correct regardless of paging
 *  (a JS reduce over one page would understate them). */
export interface InvoiceSummary {
  count: number;
  totalTtcMad: number;
  outstandingTtcMad: number;
}

/** Quote list projection — every quote field except the heavy `lines` array. */
export type QuoteListItem = Omit<QuoteRecord, 'lines'>;

/** DB-computed quote totals over the WHOLE filtered set (paging-independent). */
export interface QuoteSummary {
  count: number;
  totalTtcMad: number;
}

/** Delivery-note list projection — the note minus its `lines`, but carrying the
 *  line count the list column renders (so the page never loads the line rows). */
export type DeliveryNoteListItem = Omit<DeliveryNoteRecord, 'lines'> & {
  lineCount: number;
};

/** DB-computed client counts over the whole set (paging-independent cards). */
export interface ClientSummary {
  count: number;
  activeCount: number;
}

// ── Repository contract ──────────────────────────────────────────────────────

export const SALES_REPOSITORY = Symbol('SALES_REPOSITORY');

export interface SalesRepository {
  /** Inserts a client, or back-fills it when (companyId, name) exists. */
  upsertClient(input: UpsertClient): Promise<ClientRecord>;
  /** One DB page of clients (ordered) + the total count for the pager. */
  listClients(paging: PageParams): Promise<Paged<ClientRecord>>;
  /** DB-side client counts over the whole set (paging-independent). */
  clientsSummary(): Promise<ClientSummary>;
  getClient(id: string): Promise<ClientRecord | null>;

  /** Creates a quote with its lines; totals folded via sales.domain. */
  createQuote(input: CreateQuote): Promise<QuoteRecord>;
  issueQuote(id: string, actor: string, issuedAt: Date): Promise<QuoteRecord>;
  /** One DB page of quotes (projected, no lines) + the total matching count. */
  listQuotes(
    filter: QuoteFilter,
    paging: PageParams,
  ): Promise<Paged<QuoteListItem>>;
  /** DB-side quote totals over the whole filtered set (paging-independent). */
  quotesSummary(filter: QuoteFilter): Promise<QuoteSummary>;
  getQuote(id: string): Promise<QuoteRecord | null>;
  setQuoteStatus(id: string, status: QuoteStatus): Promise<QuoteRecord | null>;

  createDeliveryNote(input: CreateDeliveryNote): Promise<DeliveryNoteRecord>;
  issueDeliveryNote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<DeliveryNoteRecord>;
  /** One DB page of delivery notes (projected, lineCount only) + total count. */
  listDeliveryNotes(
    filter: DeliveryNoteFilter,
    paging: PageParams,
  ): Promise<Paged<DeliveryNoteListItem>>;
  getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null>;
  setDeliveryNoteStatus(
    id: string,
    status: DeliveryNoteStatus,
  ): Promise<DeliveryNoteRecord | null>;

  /** Creates an invoice with its lines; totals folded via sales.domain. */
  createInvoice(input: CreateInvoice): Promise<InvoiceRecord>;
  issueInvoice(
    id: string,
    actor: string,
    issuedAt: Date,
    legalSnapshot: LegalSellerSnapshot,
  ): Promise<InvoiceRecord>;
  updateDraftInvoice(
    id: string,
    input: UpdateInvoiceDraft,
  ): Promise<InvoiceRecord>;
  deleteDraftInvoice(id: string): Promise<void>;
  recordPayment(input: RecordInvoicePayment): Promise<InvoiceAggregate>;
  reversePayment(input: ReverseInvoicePayment): Promise<InvoiceAggregate>;
  createCreditNote(input: CreateCreditNote): Promise<CreditNoteRecord>;
  issueCreditNote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<CreditNoteRecord>;
  getInvoiceAggregate(id: string): Promise<InvoiceAggregate | null>;
  /** One DB page of invoices (projected, no lines) + the total matching count. */
  listInvoices(
    filter: InvoiceFilter,
    paging: PageParams,
  ): Promise<Paged<InvoiceListItem>>;
  /** DB-side totals over the whole filtered set (paging-independent). */
  invoicesSummary(filter: InvoiceFilter): Promise<InvoiceSummary>;
  getInvoice(id: string): Promise<InvoiceRecord | null>;
  setInvoiceStatus(
    id: string,
    status: InvoiceStatus,
    paidAt?: Date,
  ): Promise<InvoiceRecord | null>;
}
