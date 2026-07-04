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

// ── Clients ────────────────────────────────────────────────────────────────

export type ClientStatus = 'actif' | 'inactif';

export interface UpsertClient {
  name: string;
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
  reference: string;
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
  reference: string;
  objet?: string;
  status: QuoteStatus;
  quoteDate: Date;
  validUntil?: Date;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  notes?: string;
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
  reference: string;
  deliveryDate: Date;
  notes?: string;
  lines: CreateDeliveryLine[];
}

export interface DeliveryNoteRecord {
  id: string;
  clientId: string;
  projectId?: string;
  quoteId?: string;
  reference: string;
  deliveryDate: Date;
  status: DeliveryNoteStatus;
  notes?: string;
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
  reference: string;
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
  reference: string;
  invoiceDate: Date;
  dueDate?: Date;
  status: InvoiceStatus;
  totalHtMad: number;
  tvaPct: number;
  totalTtcMad: number;
  paidAt?: Date;
  notes?: string;
  createdAt: Date;
  lines: DocLineRecord[];
}

export interface InvoiceFilter {
  clientId?: string;
  status?: InvoiceStatus;
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

// ── Repository contract ──────────────────────────────────────────────────────

export const SALES_REPOSITORY = Symbol('SALES_REPOSITORY');

export interface SalesRepository {
  /** Inserts a client, or back-fills it when (companyId, name) exists. */
  upsertClient(input: UpsertClient): Promise<ClientRecord>;
  listClients(): Promise<ClientRecord[]>;
  getClient(id: string): Promise<ClientRecord | null>;

  /** Creates a quote with its lines; totals folded via sales.domain. */
  createQuote(input: CreateQuote): Promise<QuoteRecord>;
  listQuotes(filter: QuoteFilter): Promise<QuoteRecord[]>;
  getQuote(id: string): Promise<QuoteRecord | null>;
  setQuoteStatus(id: string, status: QuoteStatus): Promise<QuoteRecord | null>;

  createDeliveryNote(input: CreateDeliveryNote): Promise<DeliveryNoteRecord>;
  listDeliveryNotes(filter: DeliveryNoteFilter): Promise<DeliveryNoteRecord[]>;
  getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null>;
  setDeliveryNoteStatus(
    id: string,
    status: DeliveryNoteStatus,
  ): Promise<DeliveryNoteRecord | null>;

  /** Creates an invoice with its lines; totals folded via sales.domain. */
  createInvoice(input: CreateInvoice): Promise<InvoiceRecord>;
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
