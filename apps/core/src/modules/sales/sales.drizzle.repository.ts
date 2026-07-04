/**
 * Commercial / Ventes — Drizzle/Postgres repository over the `sales` schema.
 * Parity with InMemorySalesRepository: client upsert is one atomic INSERT …
 * ON CONFLICT (company_id, name) back-fill (mirrors the stock material upsert);
 * quote/invoice creation folds HT/TVA/TTC via sales.domain and inserts the
 * parent + its lines together (situations/avenants pattern). Money/quantities
 * are stored as numeric strings (.toString()) and surfaced as numbers (Number()).
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  clients,
  deliveryLines,
  deliveryNotes,
  invoiceLines,
  invoices,
  quoteLines,
  quotes,
} from '../../db/schema';
import { computeDocTotals, lineTotal } from './sales.domain';
import type {
  DeliveryNoteStatus,
  InvoiceStatus,
  QuoteStatus,
} from './sales.domain';
import type {
  ClientRecord,
  ClientStatus,
  CreateDeliveryNote,
  CreateInvoice,
  CreateQuote,
  DeliveryLineRecord,
  DeliveryNoteFilter,
  DeliveryNoteRecord,
  DocLineRecord,
  InvoiceFilter,
  InvoiceListItem,
  InvoiceRecord,
  InvoiceSummary,
  PageParams,
  Paged,
  QuoteFilter,
  QuoteRecord,
  SalesRepository,
  UpsertClient,
} from './sales.types';

type ClientRow = typeof clients.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;
type QuoteLineRow = typeof quoteLines.$inferSelect;
type DeliveryNoteRow = typeof deliveryNotes.$inferSelect;
type DeliveryLineRow = typeof deliveryLines.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;
type InvoiceLineRow = typeof invoiceLines.$inferSelect;

export class DrizzleSalesRepository implements SalesRepository {
  constructor(private readonly db: Db) {}

  async upsertClient(input: UpsertClient): Promise<ClientRecord> {
    // One atomic INSERT … ON CONFLICT keyed on (company_id, name). The SET clause
    // is back-fill only — a non-null incoming value enriches the row, an incoming
    // null never erases what was stored. Mirrors InMemory.upsertClient.
    const [row] = await this.db
      .insert(clients)
      .values({
        name: input.name,
        ice: input.ice,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        city: input.city,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [clients.companyId, clients.name],
        set: {
          ice: sql`coalesce(excluded.ice, ${clients.ice})`,
          contactName: sql`coalesce(excluded.contact_name, ${clients.contactName})`,
          phone: sql`coalesce(excluded.phone, ${clients.phone})`,
          email: sql`coalesce(excluded.email, ${clients.email})`,
          address: sql`coalesce(excluded.address, ${clients.address})`,
          city: sql`coalesce(excluded.city, ${clients.city})`,
          notes: sql`coalesce(excluded.notes, ${clients.notes})`,
        },
      })
      .returning();
    if (!row) throw new Error('Client upsert returned no row');
    return toClient(row);
  }

  async listClients(): Promise<ClientRecord[]> {
    const rows = await this.db
      .select()
      .from(clients)
      .orderBy(desc(clients.createdAt));
    return rows.map(toClient);
  }

  async getClient(id: string): Promise<ClientRecord | null> {
    const [row] = await this.db
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return row ? toClient(row) : null;
  }

  async createQuote(input: CreateQuote): Promise<QuoteRecord> {
    const totals = computeDocTotals(input.lines, input.tvaPct);
    // Parent + lines must commit (or roll back) together — a failed line insert
    // must never leave a header with no lines. Mirrors InMemory's single
    // mutation; same transactional shape across the sales create paths.
    return this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(quotes)
        .values({
          clientId: input.clientId,
          projectId: input.projectId,
          reference: input.reference,
          objet: input.objet,
          quoteDate: input.quoteDate,
          validUntil: input.validUntil,
          totalHtMad: totals.totalHtMad.toString(),
          tvaPct: input.tvaPct.toString(),
          totalTtcMad: totals.totalTtcMad.toString(),
          notes: input.notes,
        })
        .returning();
      if (!head) throw new Error('Quote insert returned no row');
      const lineRows = await tx
        .insert(quoteLines)
        .values(
          input.lines.map((line, idx) => ({
            quoteId: head.id,
            designation: line.designation,
            quantity: line.quantity.toString(),
            unit: line.unit,
            unitPriceMad: line.unitPriceMad.toString(),
            lineTotalMad: lineTotal(line).toString(),
            orderIndex: line.orderIndex ?? idx,
          })),
        )
        .returning();
      return toQuote(head, lineRows);
    });
  }

  async listQuotes(filter: QuoteFilter): Promise<QuoteRecord[]> {
    const rows = await this.db
      .select()
      .from(quotes)
      .where(quoteWhere(filter))
      .orderBy(desc(quotes.createdAt));
    if (rows.length === 0) return [];
    // One batched line fetch (no N+1): SELECT … WHERE quote_id = ANY($ids),
    // grouped per parent in memory; uses sales_quote_line_quote_id_idx.
    const lineRows = await this.db
      .select()
      .from(quoteLines)
      .where(
        inArray(
          quoteLines.quoteId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(quoteLines.orderIndex));
    const byQuote = groupBy(lineRows, (line) => line.quoteId);
    return rows.map((row) => toQuote(row, byQuote.get(row.id) ?? []));
  }

  async getQuote(id: string): Promise<QuoteRecord | null> {
    const [row] = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row ? this.attachQuoteLines(row) : null;
  }

  async setQuoteStatus(
    id: string,
    status: QuoteStatus,
  ): Promise<QuoteRecord | null> {
    const [row] = await this.db
      .update(quotes)
      .set({ status })
      .where(eq(quotes.id, id))
      .returning();
    return row ? this.attachQuoteLines(row) : null;
  }

  async createDeliveryNote(
    input: CreateDeliveryNote,
  ): Promise<DeliveryNoteRecord> {
    // Parent + lines commit (or roll back) atomically — same as createQuote.
    return this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(deliveryNotes)
        .values({
          clientId: input.clientId,
          projectId: input.projectId,
          quoteId: input.quoteId,
          reference: input.reference,
          deliveryDate: input.deliveryDate,
          notes: input.notes,
        })
        .returning();
      if (!head) throw new Error('Delivery note insert returned no row');
      const lineRows = await tx
        .insert(deliveryLines)
        .values(
          input.lines.map((line, idx) => ({
            deliveryNoteId: head.id,
            designation: line.designation,
            quantity: line.quantity.toString(),
            unit: line.unit,
            orderIndex: line.orderIndex ?? idx,
          })),
        )
        .returning();
      return toDeliveryNote(head, lineRows);
    });
  }

  async listDeliveryNotes(
    filter: DeliveryNoteFilter,
  ): Promise<DeliveryNoteRecord[]> {
    const rows = await this.db
      .select()
      .from(deliveryNotes)
      .where(deliveryWhere(filter))
      .orderBy(desc(deliveryNotes.createdAt));
    if (rows.length === 0) return [];
    // One batched line fetch (no N+1) — see listQuotes.
    const lineRows = await this.db
      .select()
      .from(deliveryLines)
      .where(
        inArray(
          deliveryLines.deliveryNoteId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(deliveryLines.orderIndex));
    const byNote = groupBy(lineRows, (line) => line.deliveryNoteId);
    return rows.map((row) => toDeliveryNote(row, byNote.get(row.id) ?? []));
  }

  async getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null> {
    const [row] = await this.db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, id))
      .limit(1);
    return row ? this.attachDeliveryLines(row) : null;
  }

  async setDeliveryNoteStatus(
    id: string,
    status: DeliveryNoteStatus,
  ): Promise<DeliveryNoteRecord | null> {
    const [row] = await this.db
      .update(deliveryNotes)
      .set({ status })
      .where(eq(deliveryNotes.id, id))
      .returning();
    return row ? this.attachDeliveryLines(row) : null;
  }

  async createInvoice(input: CreateInvoice): Promise<InvoiceRecord> {
    const totals = computeDocTotals(input.lines, input.tvaPct);
    // Parent + lines commit (or roll back) atomically — same as createQuote.
    return this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(invoices)
        .values({
          clientId: input.clientId,
          projectId: input.projectId,
          quoteId: input.quoteId,
          reference: input.reference,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          totalHtMad: totals.totalHtMad.toString(),
          tvaPct: input.tvaPct.toString(),
          totalTtcMad: totals.totalTtcMad.toString(),
          notes: input.notes,
        })
        .returning();
      if (!head) throw new Error('Invoice insert returned no row');
      const lineRows = await tx
        .insert(invoiceLines)
        .values(
          input.lines.map((line, idx) => ({
            invoiceId: head.id,
            designation: line.designation,
            quantity: line.quantity.toString(),
            unit: line.unit,
            unitPriceMad: line.unitPriceMad.toString(),
            lineTotalMad: lineTotal(line).toString(),
            orderIndex: line.orderIndex ?? idx,
          })),
        )
        .returning();
      return toInvoice(head, lineRows);
    });
  }

  async listInvoices(
    filter: InvoiceFilter,
    paging: PageParams,
  ): Promise<Paged<InvoiceListItem>> {
    // DB-side page: projected (no `lines`), ordered, LIMIT/OFFSET — plus a count
    // of the whole filtered set so the pager knows how many pages exist. The list
    // view never renders line items, so the batched line fetch is dropped here.
    const where = invoiceWhere(filter);
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(invoices)
        .where(where),
    ]);
    return {
      items: rows.map(toInvoiceListItem),
      total: Number(countRow?.total ?? 0),
    };
  }

  async invoicesSummary(filter: InvoiceFilter): Promise<InvoiceSummary> {
    // Totals over the WHOLE filtered set (not one page): a JS reduce over a single
    // page would understate them. `outstanding` excludes paid + cancelled.
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)`,
        totalTtcMad: sql<string>`coalesce(sum(${invoices.totalTtcMad}), 0)`,
        outstandingTtcMad: sql<string>`coalesce(sum(${invoices.totalTtcMad}) filter (where ${invoices.status} not in ('payee', 'annulee')), 0)`,
      })
      .from(invoices)
      .where(invoiceWhere(filter));
    return {
      count: Number(row?.count ?? 0),
      totalTtcMad: Number(row?.totalTtcMad ?? 0),
      outstandingTtcMad: Number(row?.outstandingTtcMad ?? 0),
    };
  }

  async getInvoice(id: string): Promise<InvoiceRecord | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return row ? this.attachInvoiceLines(row) : null;
  }

  async setInvoiceStatus(
    id: string,
    status: InvoiceStatus,
    paidAt?: Date,
  ): Promise<InvoiceRecord | null> {
    const [row] = await this.db
      .update(invoices)
      .set({ status, ...(paidAt ? { paidAt } : {}) })
      .where(eq(invoices.id, id))
      .returning();
    return row ? this.attachInvoiceLines(row) : null;
  }

  // ── line loaders ────────────────────────────────────────────────────────────

  private async attachQuoteLines(row: QuoteRow): Promise<QuoteRecord> {
    const lineRows = await this.db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, row.id))
      .orderBy(asc(quoteLines.orderIndex));
    return toQuote(row, lineRows);
  }

  private async attachDeliveryLines(
    row: DeliveryNoteRow,
  ): Promise<DeliveryNoteRecord> {
    const lineRows = await this.db
      .select()
      .from(deliveryLines)
      .where(eq(deliveryLines.deliveryNoteId, row.id))
      .orderBy(asc(deliveryLines.orderIndex));
    return toDeliveryNote(row, lineRows);
  }

  private async attachInvoiceLines(row: InvoiceRow): Promise<InvoiceRecord> {
    const lineRows = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, row.id))
      .orderBy(asc(invoiceLines.orderIndex));
    return toInvoice(row, lineRows);
  }
}

// ── line grouping (batched list loaders) ─────────────────────────────────────

/** Bucket rows by a derived key, preserving input order within each bucket. */
function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

// ── filters ────────────────────────────────────────────────────────────────

function quoteWhere(filter: QuoteFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.clientId) clauses.push(eq(quotes.clientId, filter.clientId));
  if (filter.status) clauses.push(eq(quotes.status, filter.status));
  return clauses.length ? and(...clauses) : undefined;
}

function deliveryWhere(filter: DeliveryNoteFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.clientId) clauses.push(eq(deliveryNotes.clientId, filter.clientId));
  if (filter.status) clauses.push(eq(deliveryNotes.status, filter.status));
  return clauses.length ? and(...clauses) : undefined;
}

function invoiceWhere(filter: InvoiceFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.clientId) clauses.push(eq(invoices.clientId, filter.clientId));
  if (filter.status) clauses.push(eq(invoices.status, filter.status));
  return clauses.length ? and(...clauses) : undefined;
}

// ── row → record mappers (numerics back to numbers) ──────────────────────────

function toClient(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    ice: row.ice ?? undefined,
    contactName: row.contactName ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    status: row.status as ClientStatus,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

function toDocLine(row: QuoteLineRow | InvoiceLineRow): DocLineRecord {
  return {
    id: row.id,
    designation: row.designation,
    quantity: Number(row.quantity),
    unit: row.unit ?? undefined,
    unitPriceMad: Number(row.unitPriceMad),
    lineTotalMad: Number(row.lineTotalMad),
    // invoice_line.order_index is nullable (default 0, no NOT NULL per spec); the
    // quote_line column is NOT NULL — fold both to a dense 0 fallback.
    orderIndex: row.orderIndex ?? 0,
  };
}

function toDeliveryLine(row: DeliveryLineRow): DeliveryLineRecord {
  return {
    id: row.id,
    designation: row.designation,
    quantity: Number(row.quantity),
    unit: row.unit ?? undefined,
    orderIndex: row.orderIndex ?? 0,
  };
}

function toQuote(row: QuoteRow, lineRows: QuoteLineRow[]): QuoteRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    projectId: row.projectId ?? undefined,
    reference: row.reference,
    objet: row.objet ?? undefined,
    status: row.status as QuoteStatus,
    quoteDate: row.quoteDate,
    validUntil: row.validUntil ?? undefined,
    totalHtMad: Number(row.totalHtMad),
    tvaPct: Number(row.tvaPct),
    totalTtcMad: Number(row.totalTtcMad),
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    lines: lineRows.map(toDocLine),
  };
}

function toDeliveryNote(
  row: DeliveryNoteRow,
  lineRows: DeliveryLineRow[],
): DeliveryNoteRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    projectId: row.projectId ?? undefined,
    quoteId: row.quoteId ?? undefined,
    reference: row.reference,
    deliveryDate: row.deliveryDate,
    status: row.status as DeliveryNoteRecord['status'],
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    lines: lineRows.map(toDeliveryLine),
  };
}

function toInvoice(row: InvoiceRow, lineRows: InvoiceLineRow[]): InvoiceRecord {
  return {
    ...toInvoiceListItem(row),
    lines: lineRows.map(toDocLine),
  };
}

/** List projection — every invoice field except the `lines` array. */
function toInvoiceListItem(row: InvoiceRow): InvoiceListItem {
  return {
    id: row.id,
    clientId: row.clientId,
    projectId: row.projectId ?? undefined,
    quoteId: row.quoteId ?? undefined,
    reference: row.reference,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate ?? undefined,
    status: row.status as InvoiceStatus,
    totalHtMad: Number(row.totalHtMad),
    tvaPct: Number(row.tvaPct),
    totalTtcMad: Number(row.totalTtcMad),
    paidAt: row.paidAt ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}
