import { randomUUID } from 'node:crypto';
import { asc, count, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
  suppliers,
} from '../../db/schema';
import { lineTotal, type SupplierInvoiceStatus } from './supply.domain';

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

export type SupplierStatus = 'actif' | 'inactif';
export type PurchaseOrderStatus = 'brouillon' | 'envoye' | 'recu' | 'annule';

export interface CreateSupplier {
  name: string;
  ice?: string;
  phone?: string;
  email?: string;
}
export interface SupplierRecord extends CreateSupplier {
  id: string;
  status: SupplierStatus;
  createdAt: Date;
}

/** A priced bon-de-commande line (designation + qty × unit price). */
export interface CreateOrderLine {
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  orderIndex?: number;
}
export interface PurchaseOrderLineRecord extends CreateOrderLine {
  id: string;
  lineTotalMad: number;
  orderIndex: number;
}

export interface CreatePurchaseOrder {
  supplierId: string;
  projectId?: string;
  reference: string;
  objet: string;
  amountMad: number;
  orderedAt: Date;
  /**
   * Optional line items. When provided, the order is inserted with its lines
   * and amountMad is overridden by Σ lineTotal; when omitted, amountMad is taken
   * from the input as before (backward compatible).
   */
  lines?: CreateOrderLine[];
}
export interface PurchaseOrderRecord {
  id: string;
  supplierId: string;
  projectId?: string;
  reference: string;
  objet: string;
  amountMad: number;
  status: PurchaseOrderStatus;
  orderedAt: Date;
  createdAt: Date;
  /**
   * How many line items the order carries. Always populated — list endpoints
   * compute it without materialising the lines (a COUNT aggregate, no N+1),
   * while detail endpoints derive it from the loaded `lines`.
   */
  lineCount: number;
  lines: PurchaseOrderLineRecord[];
}

/** List projection — a purchase order minus the heavy `lines` array (the list
 *  view renders only `lineCount`; the detail page still fetches the full order). */
export type PurchaseOrderListItem = Omit<PurchaseOrderRecord, 'lines'>;

/** DB-computed order totals over the WHOLE filtered set — correct regardless of
 *  paging (a JS reduce over one page would understate them as data grows). */
export interface OrdersSummary {
  count: number;
  totalMad: number;
}

export interface CreateSupplierInvoice {
  supplierId: string;
  purchaseOrderId?: string;
  reference: string;
  amountMad: number;
  invoiceDate: Date;
  dueDate: Date;
}
export interface SupplierInvoiceRecord extends CreateSupplierInvoice {
  id: string;
  status: SupplierInvoiceStatus;
  paidAt?: Date;
  createdAt: Date;
}

export const SUPPLY_REPOSITORY = Symbol('SUPPLY_REPOSITORY');

export interface SupplyRepository {
  createSupplier(input: CreateSupplier): Promise<SupplierRecord>;
  listSuppliers(): Promise<SupplierRecord[]>;
  findSupplierById(id: string): Promise<SupplierRecord | null>;
  createOrder(input: CreatePurchaseOrder): Promise<PurchaseOrderRecord>;
  /** One DB page of orders (projected, no lines) + the total matching count. */
  listOrders(paging: PageParams): Promise<Paged<PurchaseOrderListItem>>;
  /** DB-side order totals over the whole set (paging-independent). */
  ordersSummary(): Promise<OrdersSummary>;
  /** Order detail with its lines (empty array for legacy line-less orders). */
  getOrder(id: string): Promise<PurchaseOrderRecord | null>;
  /** The lines of one order (empty array when none). */
  listOrderLines(orderId: string): Promise<PurchaseOrderLineRecord[]>;
  setOrderStatus(
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<PurchaseOrderRecord | null>;
  createInvoice(input: CreateSupplierInvoice): Promise<SupplierInvoiceRecord>;
  /** One DB page of supplier invoices + the total matching count. */
  listInvoices(paging: PageParams): Promise<Paged<SupplierInvoiceRecord>>;
  /** The whole (unbounded) set of supplier invoices — for the payables aggregate,
   *  which ages every validated invoice and cannot run off a single page. */
  listAllInvoices(): Promise<SupplierInvoiceRecord[]>;
  findInvoiceById(id: string): Promise<SupplierInvoiceRecord | null>;
  setInvoiceStatus(
    id: string,
    status: SupplierInvoiceStatus,
    paidAt?: Date,
  ): Promise<SupplierInvoiceRecord | null>;
}

/** Build line records (folded line totals + dense order index) for the order. */
function toOrderLineRecords(
  lines: readonly CreateOrderLine[],
): PurchaseOrderLineRecord[] {
  return lines.map((line, idx) => ({
    id: randomUUID(),
    designation: line.designation,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceMad: line.unitPriceMad,
    lineTotalMad: lineTotal(line),
    orderIndex: line.orderIndex ?? idx,
  }));
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemorySupplyRepository implements SupplyRepository {
  private suppliers: readonly SupplierRecord[] = [];
  private orders: readonly PurchaseOrderRecord[] = [];
  private invoices: readonly SupplierInvoiceRecord[] = [];

  async createSupplier(input: CreateSupplier): Promise<SupplierRecord> {
    const record: SupplierRecord = {
      ...input,
      id: randomUUID(),
      status: 'actif',
      createdAt: new Date(),
    };
    this.suppliers = [...this.suppliers, record];
    return record;
  }
  async listSuppliers(): Promise<SupplierRecord[]> {
    return [...this.suppliers];
  }
  async findSupplierById(id: string): Promise<SupplierRecord | null> {
    return this.suppliers.find((s) => s.id === id) ?? null;
  }

  async createOrder(input: CreatePurchaseOrder): Promise<PurchaseOrderRecord> {
    // Lines present: store them and override amountMad with Σ lineTotal. Lines
    // absent: keep amountMad from the input — backward compatible.
    const lines = toOrderLineRecords(input.lines ?? []);
    const amountMad =
      lines.length > 0
        ? lines.reduce((sum, line) => sum + line.lineTotalMad, 0)
        : input.amountMad;
    const record: PurchaseOrderRecord = {
      id: randomUUID(),
      supplierId: input.supplierId,
      projectId: input.projectId,
      reference: input.reference,
      objet: input.objet,
      amountMad,
      status: 'brouillon',
      orderedAt: input.orderedAt,
      createdAt: new Date(),
      lineCount: lines.length,
      lines,
    };
    this.orders = [...this.orders, record];
    return record;
  }
  async listOrders(
    paging: PageParams,
  ): Promise<Paged<PurchaseOrderListItem>> {
    // Newest-first (mirrors the Drizzle desc(createdAt) order), then a page
    // window; the list view never renders line bodies, so `lines` is stripped.
    const matched = [...this.orders].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const items = matched
      .slice(paging.offset, paging.offset + paging.limit)
      .map(({ lines: _lines, ...item }) => item);
    return { items, total: matched.length };
  }
  async ordersSummary(): Promise<OrdersSummary> {
    // Totals over EVERY order (not one page): a JS reduce over a single page
    // would understate the cumul as the procurement log grows.
    return {
      count: this.orders.length,
      totalMad: this.orders.reduce((sum, o) => sum + o.amountMad, 0),
    };
  }
  async getOrder(id: string): Promise<PurchaseOrderRecord | null> {
    return this.orders.find((o) => o.id === id) ?? null;
  }
  async listOrderLines(orderId: string): Promise<PurchaseOrderLineRecord[]> {
    return this.orders.find((o) => o.id === orderId)?.lines ?? [];
  }
  async setOrderStatus(
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<PurchaseOrderRecord | null> {
    const existing = this.orders.find((o) => o.id === id) ?? null;
    if (!existing) return null;
    const updated = { ...existing, status };
    this.orders = this.orders.map((o) => (o.id === id ? updated : o));
    return updated;
  }

  async createInvoice(
    input: CreateSupplierInvoice,
  ): Promise<SupplierInvoiceRecord> {
    const record: SupplierInvoiceRecord = {
      ...input,
      id: randomUUID(),
      status: 'recue',
      createdAt: new Date(),
    };
    this.invoices = [...this.invoices, record];
    return record;
  }
  async listInvoices(
    paging: PageParams,
  ): Promise<Paged<SupplierInvoiceRecord>> {
    // By due date desc (mirrors the Drizzle order), then a page window.
    const matched = [...this.invoices].sort(
      (a, b) => b.dueDate.getTime() - a.dueDate.getTime(),
    );
    const items = matched.slice(paging.offset, paging.offset + paging.limit);
    return { items, total: matched.length };
  }
  async listAllInvoices(): Promise<SupplierInvoiceRecord[]> {
    return [...this.invoices];
  }
  async findInvoiceById(id: string): Promise<SupplierInvoiceRecord | null> {
    return this.invoices.find((i) => i.id === id) ?? null;
  }
  async setInvoiceStatus(
    id: string,
    status: SupplierInvoiceStatus,
    paidAt?: Date,
  ): Promise<SupplierInvoiceRecord | null> {
    const existing = this.invoices.find((i) => i.id === id) ?? null;
    if (!existing) return null;
    const updated = { ...existing, status, paidAt: paidAt ?? existing.paidAt };
    this.invoices = this.invoices.map((i) => (i.id === id ? updated : i));
    return updated;
  }
}

export class DrizzleSupplyRepository implements SupplyRepository {
  constructor(private readonly db: Db) {}

  async createSupplier(input: CreateSupplier): Promise<SupplierRecord> {
    const [row] = await this.db.insert(suppliers).values(input).returning();
    if (!row) throw new Error('Supplier insert returned no row');
    return toSupplier(row);
  }
  async listSuppliers(): Promise<SupplierRecord[]> {
    const rows = await this.db
      .select()
      .from(suppliers)
      .orderBy(desc(suppliers.createdAt));
    return rows.map(toSupplier);
  }
  async findSupplierById(id: string): Promise<SupplierRecord | null> {
    const [row] = await this.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, id))
      .limit(1);
    return row ? toSupplier(row) : null;
  }

  async createOrder(input: CreatePurchaseOrder): Promise<PurchaseOrderRecord> {
    const lines = input.lines ?? [];
    // No lines: behave exactly as before — single insert, amountMad from input.
    if (lines.length === 0) {
      const [row] = await this.db
        .insert(purchaseOrders)
        .values({
          supplierId: input.supplierId,
          projectId: input.projectId,
          reference: input.reference,
          objet: input.objet,
          amountMad: input.amountMad.toString(),
          orderedAt: input.orderedAt,
        })
        .returning();
      if (!row) throw new Error('Purchase order insert returned no row');
      return toOrder(row, []);
    }
    // Lines present: parent + lines commit (or roll back) together and amountMad
    // is Σ lineTotal (mirrors the sales createQuote/createInvoice shape).
    const amountMad = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    return this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(purchaseOrders)
        .values({
          supplierId: input.supplierId,
          projectId: input.projectId,
          reference: input.reference,
          objet: input.objet,
          amountMad: amountMad.toString(),
          orderedAt: input.orderedAt,
        })
        .returning();
      if (!head) throw new Error('Purchase order insert returned no row');
      const lineRows = await tx
        .insert(purchaseOrderLines)
        .values(
          lines.map((line, idx) => ({
            purchaseOrderId: head.id,
            designation: line.designation,
            quantity: line.quantity.toString(),
            unit: line.unit,
            unitPriceMad: line.unitPriceMad.toString(),
            lineTotalMad: lineTotal(line).toString(),
            orderIndex: line.orderIndex ?? idx,
          })),
        )
        .returning();
      return toOrder(head, lineRows);
    });
  }
  async listOrders(
    paging: PageParams,
  ): Promise<Paged<PurchaseOrderListItem>> {
    // DB-side page: one grouped query (each order + the COUNT of its lines via a
    // LEFT JOIN, so line-less orders read 0 without an N+1) ordered newest-first
    // with LIMIT/OFFSET — plus a parallel count of the whole set so the pager
    // knows how many pages exist. The list view never renders line bodies, so
    // each item is projected without the (already empty) `lines` array.
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select({
          order: purchaseOrders,
          lineCount: count(purchaseOrderLines.id),
        })
        .from(purchaseOrders)
        .leftJoin(
          purchaseOrderLines,
          eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id),
        )
        .groupBy(purchaseOrders.id)
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: sql<number>`count(*)` }).from(purchaseOrders),
    ]);
    return {
      items: rows.map((row) =>
        toOrderListItem(row.order, Number(row.lineCount)),
      ),
      total: Number(countRow?.total ?? 0),
    };
  }
  async ordersSummary(): Promise<OrdersSummary> {
    // Totals over the WHOLE set (not one page): a JS reduce over a single page
    // would understate the cumul as the procurement log grows.
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)`,
        totalMad: sql<string>`coalesce(sum(${purchaseOrders.amountMad}), 0)`,
      })
      .from(purchaseOrders);
    return {
      count: Number(row?.count ?? 0),
      totalMad: Number(row?.totalMad ?? 0),
    };
  }
  async getOrder(id: string): Promise<PurchaseOrderRecord | null> {
    const [row] = await this.db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .limit(1);
    if (!row) return null;
    const lineRows = await this.fetchOrderLines(id);
    return toOrder(row, lineRows);
  }
  async listOrderLines(orderId: string): Promise<PurchaseOrderLineRecord[]> {
    const lineRows = await this.fetchOrderLines(orderId);
    return lineRows.map(toOrderLine);
  }
  async setOrderStatus(
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<PurchaseOrderRecord | null> {
    const [row] = await this.db
      .update(purchaseOrders)
      .set({ status })
      .where(eq(purchaseOrders.id, id))
      .returning();
    if (!row) return null;
    // Re-fetch lines so the returned record carries them (consistent with
    // getOrder). Callers that ignore `lines` are unaffected; those that read it
    // after a transition no longer receive a spurious empty array.
    const lineRows = await this.fetchOrderLines(id);
    return toOrder(row, lineRows);
  }

  /** Lines of one order, ordered by orderIndex — uses the line FK index. */
  private async fetchOrderLines(orderId: string): Promise<OrderLineRow[]> {
    return this.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
      .orderBy(asc(purchaseOrderLines.orderIndex));
  }

  async createInvoice(
    input: CreateSupplierInvoice,
  ): Promise<SupplierInvoiceRecord> {
    const [row] = await this.db
      .insert(supplierInvoices)
      .values({
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId,
        reference: input.reference,
        amountMad: input.amountMad.toString(),
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
      })
      .returning();
    if (!row) throw new Error('Supplier invoice insert returned no row');
    return toInvoice(row);
  }
  async listInvoices(
    paging: PageParams,
  ): Promise<Paged<SupplierInvoiceRecord>> {
    // DB-side page: ordered by due date (échéancier), LIMIT/OFFSET — plus a
    // parallel count of the whole set so the pager knows how many pages exist.
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(supplierInvoices)
        .orderBy(desc(supplierInvoices.dueDate))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: sql<number>`count(*)` }).from(supplierInvoices),
    ]);
    return {
      items: rows.map(toInvoice),
      total: Number(countRow?.total ?? 0),
    };
  }
  async listAllInvoices(): Promise<SupplierInvoiceRecord[]> {
    // Whole (unbounded) set — the payables aggregate ages every validated
    // invoice and cannot run off a single page.
    const rows = await this.db
      .select()
      .from(supplierInvoices)
      .orderBy(desc(supplierInvoices.dueDate));
    return rows.map(toInvoice);
  }
  async findInvoiceById(id: string): Promise<SupplierInvoiceRecord | null> {
    const [row] = await this.db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, id))
      .limit(1);
    return row ? toInvoice(row) : null;
  }
  async setInvoiceStatus(
    id: string,
    status: SupplierInvoiceStatus,
    paidAt?: Date,
  ): Promise<SupplierInvoiceRecord | null> {
    const [row] = await this.db
      .update(supplierInvoices)
      .set({ status, ...(paidAt ? { paidAt } : {}) })
      .where(eq(supplierInvoices.id, id))
      .returning();
    return row ? toInvoice(row) : null;
  }
}

type SupplierRow = typeof suppliers.$inferSelect;
type OrderRow = typeof purchaseOrders.$inferSelect;
type OrderLineRow = typeof purchaseOrderLines.$inferSelect;
type InvoiceRow = typeof supplierInvoices.$inferSelect;

function toSupplier(row: SupplierRow): SupplierRecord {
  return {
    id: row.id,
    name: row.name,
    ice: row.ice ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    status: row.status as SupplierStatus,
    createdAt: row.createdAt,
  };
}
function toOrderLine(row: OrderLineRow): PurchaseOrderLineRecord {
  return {
    id: row.id,
    designation: row.designation,
    quantity: Number(row.quantity),
    unit: row.unit ?? undefined,
    unitPriceMad: Number(row.unitPriceMad),
    lineTotalMad: Number(row.lineTotalMad),
    orderIndex: row.orderIndex,
  };
}
/**
 * List projection — every order field except the `lines` array. `lineCount` is
 * passed explicitly by list endpoints from a COUNT aggregate so they can omit
 * the line bodies entirely.
 */
function toOrderListItem(
  row: OrderRow,
  lineCount: number,
): PurchaseOrderListItem {
  return {
    id: row.id,
    supplierId: row.supplierId,
    projectId: row.projectId ?? undefined,
    reference: row.reference,
    objet: row.objet,
    amountMad: Number(row.amountMad),
    status: row.status as PurchaseOrderStatus,
    orderedAt: row.orderedAt,
    createdAt: row.createdAt,
    lineCount,
  };
}
/**
 * Map an order row to a full record. `lineCount` defaults to the number of
 * supplied line rows (detail/transition paths), but callers may pass an explicit
 * count from a COUNT aggregate.
 */
function toOrder(
  row: OrderRow,
  lineRows: OrderLineRow[],
  lineCount: number = lineRows.length,
): PurchaseOrderRecord {
  return {
    ...toOrderListItem(row, lineCount),
    lines: lineRows.map(toOrderLine),
  };
}
function toInvoice(row: InvoiceRow): SupplierInvoiceRecord {
  return {
    id: row.id,
    supplierId: row.supplierId,
    purchaseOrderId: row.purchaseOrderId ?? undefined,
    reference: row.reference,
    amountMad: Number(row.amountMad),
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    status: row.status as SupplierInvoiceStatus,
    paidAt: row.paidAt ?? undefined,
    createdAt: row.createdAt,
  };
}
