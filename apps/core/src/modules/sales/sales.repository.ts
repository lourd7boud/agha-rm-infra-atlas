/**
 * Commercial / Ventes — in-memory repository (dev/test fallback when
 * DATABASE_URL is unset). Mirrors the situations/avenants parent+lines shape:
 * a document is stored with its lines attached, and quote/invoice totals are
 * folded through sales.domain on create so figures match the Drizzle path.
 * Client upsert keys on name (the DB upserts on (companyId, name)).
 */
import { randomUUID } from 'node:crypto';
import { computeDocTotals, lineTotal } from './sales.domain';
import type {
  ClientRecord,
  CreateDeliveryNote,
  CreateInvoice,
  CreateQuote,
  DeliveryLineRecord,
  DeliveryNoteFilter,
  DeliveryNoteRecord,
  DocLineRecord,
  InvoiceFilter,
  InvoiceRecord,
  QuoteFilter,
  QuoteRecord,
  SalesRepository,
  UpsertClient,
} from './sales.types';
import type {
  DeliveryNoteStatus,
  InvoiceStatus,
  QuoteStatus,
} from './sales.domain';

/** Build priced line records (with folded line totals + dense order index). */
function toDocLineRecords(
  lines: CreateQuote['lines'],
): DocLineRecord[] {
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

function toDeliveryLineRecords(
  lines: CreateDeliveryNote['lines'],
): DeliveryLineRecord[] {
  return lines.map((line, idx) => ({
    id: randomUUID(),
    designation: line.designation,
    quantity: line.quantity,
    unit: line.unit,
    orderIndex: line.orderIndex ?? idx,
  }));
}

export class InMemorySalesRepository implements SalesRepository {
  private clients: readonly ClientRecord[] = [];
  private quotes: readonly QuoteRecord[] = [];
  private deliveryNotes: readonly DeliveryNoteRecord[] = [];
  private invoices: readonly InvoiceRecord[] = [];

  async upsertClient(input: UpsertClient): Promise<ClientRecord> {
    const index = this.clients.findIndex((c) => c.name === input.name);
    if (index === -1) {
      const record: ClientRecord = {
        id: randomUUID(),
        name: input.name,
        ice: input.ice,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        city: input.city,
        status: 'actif',
        notes: input.notes,
        createdAt: new Date(),
      };
      this.clients = [...this.clients, record];
      return record;
    }
    const existing = this.clients[index]!;
    // Back-fill only: incoming non-null enriches, incoming null keeps existing.
    const merged: ClientRecord = {
      ...existing,
      ice: input.ice ?? existing.ice,
      contactName: input.contactName ?? existing.contactName,
      phone: input.phone ?? existing.phone,
      email: input.email ?? existing.email,
      address: input.address ?? existing.address,
      city: input.city ?? existing.city,
      notes: input.notes ?? existing.notes,
    };
    this.clients = [
      ...this.clients.slice(0, index),
      merged,
      ...this.clients.slice(index + 1),
    ];
    return merged;
  }

  async listClients(): Promise<ClientRecord[]> {
    return [...this.clients];
  }

  async getClient(id: string): Promise<ClientRecord | null> {
    return this.clients.find((c) => c.id === id) ?? null;
  }

  async createQuote(input: CreateQuote): Promise<QuoteRecord> {
    const lines = toDocLineRecords(input.lines);
    const totals = computeDocTotals(input.lines, input.tvaPct);
    const record: QuoteRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      projectId: input.projectId,
      reference: input.reference,
      objet: input.objet,
      status: 'brouillon',
      quoteDate: input.quoteDate,
      validUntil: input.validUntil,
      totalHtMad: totals.totalHtMad,
      tvaPct: input.tvaPct,
      totalTtcMad: totals.totalTtcMad,
      notes: input.notes,
      createdAt: new Date(),
      lines,
    };
    this.quotes = [...this.quotes, record];
    return record;
  }

  async listQuotes(filter: QuoteFilter): Promise<QuoteRecord[]> {
    return [...this.quotes]
      .filter((q) => {
        if (filter.clientId && q.clientId !== filter.clientId) return false;
        if (filter.status && q.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getQuote(id: string): Promise<QuoteRecord | null> {
    return this.quotes.find((q) => q.id === id) ?? null;
  }

  async setQuoteStatus(
    id: string,
    status: QuoteStatus,
  ): Promise<QuoteRecord | null> {
    const existing = this.quotes.find((q) => q.id === id) ?? null;
    if (!existing) return null;
    const updated: QuoteRecord = { ...existing, status };
    this.quotes = this.quotes.map((q) => (q.id === id ? updated : q));
    return updated;
  }

  async createDeliveryNote(
    input: CreateDeliveryNote,
  ): Promise<DeliveryNoteRecord> {
    const record: DeliveryNoteRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      projectId: input.projectId,
      quoteId: input.quoteId,
      reference: input.reference,
      deliveryDate: input.deliveryDate,
      status: 'brouillon',
      notes: input.notes,
      createdAt: new Date(),
      lines: toDeliveryLineRecords(input.lines),
    };
    this.deliveryNotes = [...this.deliveryNotes, record];
    return record;
  }

  async listDeliveryNotes(
    filter: DeliveryNoteFilter,
  ): Promise<DeliveryNoteRecord[]> {
    return [...this.deliveryNotes]
      .filter((d) => {
        if (filter.clientId && d.clientId !== filter.clientId) return false;
        if (filter.status && d.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null> {
    return this.deliveryNotes.find((d) => d.id === id) ?? null;
  }

  async setDeliveryNoteStatus(
    id: string,
    status: DeliveryNoteStatus,
  ): Promise<DeliveryNoteRecord | null> {
    const existing = this.deliveryNotes.find((d) => d.id === id) ?? null;
    if (!existing) return null;
    const updated: DeliveryNoteRecord = { ...existing, status };
    this.deliveryNotes = this.deliveryNotes.map((d) =>
      d.id === id ? updated : d,
    );
    return updated;
  }

  async createInvoice(input: CreateInvoice): Promise<InvoiceRecord> {
    const lines = toDocLineRecords(input.lines);
    const totals = computeDocTotals(input.lines, input.tvaPct);
    const record: InvoiceRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      projectId: input.projectId,
      quoteId: input.quoteId,
      reference: input.reference,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      status: 'brouillon',
      totalHtMad: totals.totalHtMad,
      tvaPct: input.tvaPct,
      totalTtcMad: totals.totalTtcMad,
      notes: input.notes,
      createdAt: new Date(),
      lines,
    };
    this.invoices = [...this.invoices, record];
    return record;
  }

  async listInvoices(filter: InvoiceFilter): Promise<InvoiceRecord[]> {
    return [...this.invoices]
      .filter((i) => {
        if (filter.clientId && i.clientId !== filter.clientId) return false;
        if (filter.status && i.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getInvoice(id: string): Promise<InvoiceRecord | null> {
    return this.invoices.find((i) => i.id === id) ?? null;
  }

  async setInvoiceStatus(
    id: string,
    status: InvoiceStatus,
    paidAt?: Date,
  ): Promise<InvoiceRecord | null> {
    const existing = this.invoices.find((i) => i.id === id) ?? null;
    if (!existing) return null;
    const updated: InvoiceRecord = {
      ...existing,
      status,
      paidAt: paidAt ?? existing.paidAt,
    };
    this.invoices = this.invoices.map((i) => (i.id === id ? updated : i));
    return updated;
  }
}
