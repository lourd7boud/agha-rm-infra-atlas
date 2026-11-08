/**
 * Commercial / Ventes — in-memory repository (dev/test fallback when
 * DATABASE_URL is unset). Mirrors the situations/avenants parent+lines shape:
 * a document is stored with its lines attached, and quote/invoice totals are
 * folded through sales.domain on create so figures match the Drizzle path.
 * Client upsert keys on name (the DB upserts on (companyId, name)).
 */
import { randomUUID } from 'node:crypto';
import {
  computeDocTotals,
  docExercice,
  formatDocReference,
  lineTotal,
} from './sales.domain';
import {
  allocateCreditNote,
  deriveSettlement,
  summarizePaymentMovements,
} from './sales-invoice.domain';
import { parseMoneyCents } from './sales-money.domain';
import type {
  ClientRecord,
  ClientSummary,
  CreateDeliveryNote,
  CreateCreditNote,
  CreateInvoice,
  CreateQuote,
  DeliveryLineRecord,
  DeliveryNoteFilter,
  DeliveryNoteListItem,
  DeliveryNoteRecord,
  DocLineRecord,
  InvoiceFilter,
  InvoiceAggregate,
  InvoiceListItem,
  InvoicePaymentRecord,
  InvoiceRecord,
  InvoiceSummary,
  PageParams,
  Paged,
  QuoteFilter,
  QuoteListItem,
  QuoteRecord,
  QuoteSummary,
  RecordInvoicePayment,
  ReverseInvoicePayment,
  SalesAccountingEventRecord,
  SalesRepository,
  LegalSellerSnapshot,
  CreditNoteRecord,
  UpdateInvoiceDraft,
  UpsertClient,
} from './sales.types';
import type {
  DeliveryNoteStatus,
  DocType,
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
  private payments: readonly InvoicePaymentRecord[] = [];
  private creditNotes: readonly CreditNoteRecord[] = [];
  private accountingEvents: readonly SalesAccountingEventRecord[] = [];
  /** Per-(docType, exercice) counters — the in-memory twin of the Drizzle
   *  sales.doc_sequence table, so both paths mint identical FAC-YYYY-NNNN refs. */
  private readonly sequences = new Map<string, number>();

  private appendAccountingEvent(
    eventType: string,
    sourceId: string,
    sourceVersion: number,
    occurredAt: Date,
  ): void {
    const eventKey = `${eventType}:${sourceId}:${sourceVersion}`;
    if (this.accountingEvents.some((event) => event.eventKey === eventKey)) return;
    this.accountingEvents = [
      ...this.accountingEvents,
      {
        id: randomUUID(),
        eventKey,
        eventType,
        sourceId,
        sourceVersion,
        occurredAt,
        status: 'pending',
      },
    ];
  }

  /** Next gap-free sequential reference for a document, keyed on its fiscal year. */
  private nextReference(docType: DocType, date: Date): string {
    const exercice = docExercice(date);
    const key = `${docType}:${exercice}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return formatDocReference(docType, exercice, next);
  }

  async upsertClient(input: UpsertClient): Promise<ClientRecord> {
    const index = this.clients.findIndex((c) => c.name === input.name);
    if (index === -1) {
      const record: ClientRecord = {
        id: randomUUID(),
        name: input.name,
        clientType: input.clientType ?? 'professionnel',
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
      clientType: input.clientType ?? existing.clientType,
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

  async listClients(paging: PageParams): Promise<Paged<ClientRecord>> {
    const ordered = [...this.clients].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const items = ordered.slice(paging.offset, paging.offset + paging.limit);
    return { items, total: ordered.length };
  }

  async clientsSummary(): Promise<ClientSummary> {
    return {
      count: this.clients.length,
      activeCount: this.clients.filter((c) => c.status === 'actif').length,
    };
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
      reference: null,
      objet: input.objet,
      status: 'brouillon',
      quoteDate: input.quoteDate,
      validUntil: input.validUntil,
      totalHtMad: totals.totalHtMad,
      tvaPct: input.tvaPct,
      totalTtcMad: totals.totalTtcMad,
      notes: input.notes,
      version: 1,
      createdAt: new Date(),
      lines,
    };
    this.quotes = [...this.quotes, record];
    return record;
  }

  async listQuotes(
    filter: QuoteFilter,
    paging: PageParams,
  ): Promise<Paged<QuoteListItem>> {
    const matched = this.matchQuotes(filter).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const items = matched
      .slice(paging.offset, paging.offset + paging.limit)
      .map(({ lines: _lines, ...item }) => item);
    return { items, total: matched.length };
  }

  async quotesSummary(filter: QuoteFilter): Promise<QuoteSummary> {
    const matched = this.matchQuotes(filter);
    return {
      count: matched.length,
      totalTtcMad: matched.reduce((sum, q) => sum + q.totalTtcMad, 0),
    };
  }

  private matchQuotes(filter: QuoteFilter): QuoteRecord[] {
    return this.quotes.filter((q) => {
      if (filter.clientId && q.clientId !== filter.clientId) return false;
      if (filter.status && q.status !== filter.status) return false;
      return true;
    });
  }

  async getQuote(id: string): Promise<QuoteRecord | null> {
    return this.quotes.find((q) => q.id === id) ?? null;
  }

  async issueQuote(
    id: string,
    actor: string,
    issuedAt: Date,
    snapshot?: LegalSellerSnapshot,
  ): Promise<QuoteRecord> {
    const existing = this.quotes.find((quote) => quote.id === id);
    if (!existing) throw new Error('Devis introuvable.');
    if (existing.reference) return existing;
    if (existing.status !== 'brouillon') {
      throw new Error('Seul un devis brouillon peut être émis.');
    }
    const updated: QuoteRecord = {
      ...existing,
      reference: this.nextReference('devis', existing.quoteDate),
      legalSnapshot: snapshot ? structuredClone(snapshot) : undefined,
      status: 'envoye',
      issuedAt,
      issuedBy: actor,
      version: existing.version + 1,
    };
    this.quotes = this.quotes.map((quote) => (quote.id === id ? updated : quote));
    return updated;
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
      reference: null,
      deliveryDate: input.deliveryDate,
      status: 'brouillon',
      notes: input.notes,
      version: 1,
      createdAt: new Date(),
      lines: toDeliveryLineRecords(input.lines),
    };
    this.deliveryNotes = [...this.deliveryNotes, record];
    return record;
  }

  async listDeliveryNotes(
    filter: DeliveryNoteFilter,
    paging: PageParams,
  ): Promise<Paged<DeliveryNoteListItem>> {
    const matched = this.matchDeliveryNotes(filter).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    // Project to the list shape: drop `lines`, carry only its count.
    const items = matched
      .slice(paging.offset, paging.offset + paging.limit)
      .map(({ lines, ...rest }) => ({ ...rest, lineCount: lines.length }));
    return { items, total: matched.length };
  }

  private matchDeliveryNotes(filter: DeliveryNoteFilter): DeliveryNoteRecord[] {
    return this.deliveryNotes.filter((d) => {
      if (filter.clientId && d.clientId !== filter.clientId) return false;
      if (filter.status && d.status !== filter.status) return false;
      return true;
    });
  }

  async getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null> {
    return this.deliveryNotes.find((d) => d.id === id) ?? null;
  }

  async issueDeliveryNote(
    id: string,
    actor: string,
    issuedAt: Date,
    snapshot?: LegalSellerSnapshot,
  ): Promise<DeliveryNoteRecord> {
    const existing = this.deliveryNotes.find((note) => note.id === id);
    if (!existing) throw new Error('Bon de livraison introuvable.');
    if (existing.reference) return existing;
    if (existing.status !== 'brouillon') {
      throw new Error('Seul un bon de livraison brouillon peut être émis.');
    }
    const updated: DeliveryNoteRecord = {
      ...existing,
      reference: this.nextReference('bl', existing.deliveryDate),
      legalSnapshot: snapshot ? structuredClone(snapshot) : undefined,
      status: 'livre',
      issuedAt,
      issuedBy: actor,
      version: existing.version + 1,
    };
    this.deliveryNotes = this.deliveryNotes.map((note) =>
      note.id === id ? updated : note,
    );
    return updated;
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
      reference: null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      status: 'brouillon',
      totalHtMad: totals.totalHtMad,
      tvaPct: input.tvaPct,
      tvaMad: totals.tvaMad,
      totalTtcMad: totals.totalTtcMad,
      notes: input.notes,
      version: 1,
      legacyPaid: false,
      createdAt: new Date(),
      lines,
    };
    this.invoices = [...this.invoices, record];
    return record;
  }

  async issueInvoice(
    id: string,
    actor: string,
    issuedAt: Date,
    legalSnapshot: LegalSellerSnapshot,
  ): Promise<InvoiceRecord> {
    const existing = this.invoices.find((invoice) => invoice.id === id);
    if (!existing) throw new Error('Facture introuvable.');
    if (existing.reference) return existing;
    if (existing.status !== 'brouillon') {
      throw new Error('Seule une facture brouillon peut être émise.');
    }
    const client = this.clients.find((candidate) => candidate.id === existing.clientId);
    const updated: InvoiceRecord = {
      ...existing,
      reference: this.nextReference('facture', existing.invoiceDate),
      status: 'emise',
      issuedAt,
      issuedBy: actor,
      legalSnapshot: {
        ...legalSnapshot,
        client: client ? {
          name: client.name,
          clientType: client.clientType,
          address: client.address,
          city: client.city,
          ice: client.ice,
        } : legalSnapshot.client,
      },
      version: existing.version + 1,
    };
    this.invoices = this.invoices.map((invoice) =>
      invoice.id === id ? updated : invoice,
    );
    this.appendAccountingEvent('invoice_issued', id, updated.version, issuedAt);
    return updated;
  }

  async updateDraftInvoice(
    id: string,
    input: UpdateInvoiceDraft,
  ): Promise<InvoiceRecord> {
    const existing = this.invoices.find((invoice) => invoice.id === id);
    if (!existing) throw new Error('Facture introuvable.');
    if (existing.status !== 'brouillon') {
      throw new Error('Une facture émise ne peut plus être modifiée.');
    }
    if (existing.version !== input.version) {
      throw new Error('La facture a été modifiée par un autre utilisateur.');
    }
    const updated: InvoiceRecord = {
      ...existing,
      dueDate: input.dueDate ?? existing.dueDate,
      paymentTerms: input.paymentTerms ?? existing.paymentTerms,
      notes: input.notes ?? existing.notes,
      version: existing.version + 1,
    };
    this.invoices = this.invoices.map((invoice) =>
      invoice.id === id ? updated : invoice,
    );
    return updated;
  }

  async deleteDraftInvoice(id: string): Promise<void> {
    const existing = this.invoices.find((invoice) => invoice.id === id);
    if (!existing) return;
    if (existing.status !== 'brouillon') {
      throw new Error('Une facture émise ne peut plus être supprimée.');
    }
    this.invoices = this.invoices.filter((invoice) => invoice.id !== id);
  }

  async getInvoiceAggregate(id: string): Promise<InvoiceAggregate | null> {
    const invoice = this.invoices.find((candidate) => candidate.id === id);
    if (!invoice) return null;
    const payments = this.payments.filter((payment) => payment.invoiceId === id);
    const creditNotes = this.creditNotes.filter(
      (creditNote) => creditNote.invoiceId === id,
    );
    const issuedCredits = creditNotes.filter(
      (creditNote) => creditNote.status !== 'brouillon',
    );
    const summarized = summarizePaymentMovements(
      payments.map((payment) => ({
        type: payment.movementType,
        amountCents: payment.amountCents,
      })),
    );
    const totalCents = parseMoneyCents(invoice.totalTtcMad);
    const legacyPaidOpening = invoice.legacyPaid && payments.length === 0;
    const settlement = deriveSettlement({
      totalCents,
      receivedCents: legacyPaidOpening ? totalCents : summarized.receivedCents,
      refundedCents: summarized.refundedCents,
      creditedCents: issuedCredits.reduce(
        (total, creditNote) => total + creditNote.totalTtcCents,
        0,
      ),
    });
    const latestEvent = [...this.accountingEvents]
      .filter((event) => event.sourceId === id)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];
    return {
      invoice,
      payments,
      creditNotes,
      settlement,
      accountingProjection: latestEvent?.status ?? 'pending',
      legacyPaidOpening,
    };
  }

  async recordPayment(input: RecordInvoicePayment): Promise<InvoiceAggregate> {
    const invoice = this.invoices.find((candidate) => candidate.id === input.invoiceId);
    if (!invoice || invoice.status === 'brouillon') {
      throw new Error('La facture doit être émise avant tout règlement.');
    }
    const duplicate = this.payments.find(
      (payment) =>
        payment.invoiceId === input.invoiceId &&
        payment.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) return (await this.getInvoiceAggregate(input.invoiceId))!;
    const aggregate = (await this.getInvoiceAggregate(input.invoiceId))!;
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > aggregate.settlement.outstandingCents
    ) {
      throw new Error('Le règlement dépasse le solde restant ou est invalide.');
    }
    const payment: InvoicePaymentRecord = {
      id: randomUUID(),
      invoiceId: input.invoiceId,
      movementType: 'encaissement',
      amountCents: input.amountCents,
      method: input.method,
      treasuryAccount: input.treasuryAccount,
      valueDate: input.valueDate,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.actor,
      createdAt: new Date(),
    };
    this.payments = [...this.payments, payment];
    this.appendAccountingEvent(
      'payment_recorded',
      input.invoiceId,
      this.payments.filter((item) => item.invoiceId === input.invoiceId).length,
      payment.createdAt,
    );
    return (await this.getInvoiceAggregate(input.invoiceId))!;
  }

  async reversePayment(input: ReverseInvoicePayment): Promise<InvoiceAggregate> {
    const original = this.payments.find(
      (payment) =>
        payment.id === input.paymentId && payment.invoiceId === input.invoiceId,
    );
    if (!original || original.movementType !== 'encaissement') {
      throw new Error('Règlement original introuvable.');
    }
    const existingReversal = this.payments.find(
      (payment) => payment.originalMovementId === original.id,
    );
    if (!existingReversal) {
      const reversal: InvoicePaymentRecord = {
        id: randomUUID(),
        invoiceId: input.invoiceId,
        movementType: 'remboursement',
        amountCents: original.amountCents,
        method: original.method,
        treasuryAccount: original.treasuryAccount,
        valueDate: input.valueDate,
        originalMovementId: original.id,
        idempotencyKey: input.idempotencyKey,
        createdBy: input.actor,
        createdAt: new Date(),
      };
      this.payments = [...this.payments, reversal];
      this.appendAccountingEvent(
        'payment_reversed',
        input.invoiceId,
        this.payments.filter((item) => item.invoiceId === input.invoiceId).length,
        reversal.createdAt,
      );
    }
    return (await this.getInvoiceAggregate(input.invoiceId))!;
  }

  async createCreditNote(input: CreateCreditNote): Promise<CreditNoteRecord> {
    const invoice = this.invoices.find((candidate) => candidate.id === input.invoiceId);
    if (!invoice || invoice.status === 'brouillon') {
      throw new Error('La facture doit être émise avant de créer un avoir.');
    }
    if (
      !Number.isSafeInteger(input.totalHtCents) ||
      !Number.isSafeInteger(input.tvaCents) ||
      input.totalHtCents < 0 ||
      input.tvaCents < 0 ||
      input.totalHtCents + input.tvaCents <= 0
    ) {
      throw new Error('Le montant de l’avoir est invalide.');
    }
    const creditNote: CreditNoteRecord = {
      id: randomUUID(),
      invoiceId: input.invoiceId,
      reference: null,
      status: 'brouillon',
      creditDate: input.creditDate,
      totalHtCents: input.totalHtCents,
      tvaCents: input.tvaCents,
      totalTtcCents: input.totalHtCents + input.tvaCents,
      againstOutstandingCents: 0,
      againstCollectedCents: 0,
      reason: input.reason,
      version: 1,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.creditNotes = [...this.creditNotes, creditNote];
    return creditNote;
  }

  async issueCreditNote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<CreditNoteRecord> {
    const existing = this.creditNotes.find((creditNote) => creditNote.id === id);
    if (!existing) throw new Error('Avoir introuvable.');
    if (existing.reference) return existing;
    const aggregate = (await this.getInvoiceAggregate(existing.invoiceId))!;
    const allocation = allocateCreditNote({
      invoiceTotalCents: parseMoneyCents(aggregate.invoice.totalTtcMad),
      previouslyCreditedCents: aggregate.creditNotes
        .filter((creditNote) => creditNote.status !== 'brouillon')
        .reduce((total, creditNote) => total + creditNote.totalTtcCents, 0),
      netReceivedCents: aggregate.settlement.netReceivedCents,
      requestedCreditCents: existing.totalTtcCents,
    });
    const updated: CreditNoteRecord = {
      ...existing,
      reference: this.nextReference('avoir', existing.creditDate),
      status: 'emise',
      issuedAt,
      issuedBy: actor,
      againstOutstandingCents: allocation.againstOutstandingCents,
      againstCollectedCents: allocation.againstCollectedCents,
      version: existing.version + 1,
    };
    this.creditNotes = this.creditNotes.map((creditNote) =>
      creditNote.id === id ? updated : creditNote,
    );
    this.appendAccountingEvent('credit_note_issued', id, updated.version, issuedAt);
    return updated;
  }

  async listInvoices(
    filter: InvoiceFilter,
    paging: PageParams,
  ): Promise<Paged<InvoiceListItem>> {
    const matched = this.matchInvoices(filter).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const items = matched
      .slice(paging.offset, paging.offset + paging.limit)
      .map(({ lines: _lines, ...item }) => item);
    return { items, total: matched.length };
  }

  async invoicesSummary(filter: InvoiceFilter): Promise<InvoiceSummary> {
    const matched = this.matchInvoices(filter);
    const outstandingTtcMad = matched
      .filter((i) => i.status !== 'payee' && i.status !== 'annulee')
      .reduce((sum, i) => sum + i.totalTtcMad, 0);
    return {
      count: matched.length,
      totalTtcMad: matched.reduce((sum, i) => sum + i.totalTtcMad, 0),
      outstandingTtcMad,
    };
  }

  private matchInvoices(filter: InvoiceFilter): InvoiceRecord[] {
    return this.invoices.filter((i) => {
      if (filter.clientId && i.clientId !== filter.clientId) return false;
      if (filter.status && i.status !== filter.status) return false;
      return true;
    });
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
