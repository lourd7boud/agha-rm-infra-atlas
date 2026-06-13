import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { purchaseOrders, supplierInvoices, suppliers } from '../../db/schema';
import type { SupplierInvoiceStatus } from './supply.domain';

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

export interface CreatePurchaseOrder {
  supplierId: string;
  projectId?: string;
  reference: string;
  objet: string;
  amountMad: number;
  orderedAt: Date;
}
export interface PurchaseOrderRecord extends CreatePurchaseOrder {
  id: string;
  status: PurchaseOrderStatus;
  createdAt: Date;
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
  listOrders(): Promise<PurchaseOrderRecord[]>;
  setOrderStatus(
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<PurchaseOrderRecord | null>;
  createInvoice(input: CreateSupplierInvoice): Promise<SupplierInvoiceRecord>;
  listInvoices(): Promise<SupplierInvoiceRecord[]>;
  findInvoiceById(id: string): Promise<SupplierInvoiceRecord | null>;
  setInvoiceStatus(
    id: string,
    status: SupplierInvoiceStatus,
    paidAt?: Date,
  ): Promise<SupplierInvoiceRecord | null>;
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
    const record: PurchaseOrderRecord = {
      ...input,
      id: randomUUID(),
      status: 'brouillon',
      createdAt: new Date(),
    };
    this.orders = [...this.orders, record];
    return record;
  }
  async listOrders(): Promise<PurchaseOrderRecord[]> {
    return [...this.orders];
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
  async listInvoices(): Promise<SupplierInvoiceRecord[]> {
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
    return toOrder(row);
  }
  async listOrders(): Promise<PurchaseOrderRecord[]> {
    const rows = await this.db
      .select()
      .from(purchaseOrders)
      .orderBy(desc(purchaseOrders.createdAt));
    return rows.map(toOrder);
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
    return row ? toOrder(row) : null;
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
  async listInvoices(): Promise<SupplierInvoiceRecord[]> {
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
function toOrder(row: OrderRow): PurchaseOrderRecord {
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
