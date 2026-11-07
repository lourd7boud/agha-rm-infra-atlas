/**
 * Commercial / Ventes — Drizzle/Postgres repository over the `sales` schema.
 * Parity with InMemorySalesRepository: client upsert is one atomic INSERT …
 * ON CONFLICT (company_id, name) back-fill (mirrors the stock material upsert);
 * quote/invoice creation folds HT/TVA/TTC via sales.domain and inserts the
 * parent + its lines together (situations/avenants pattern). Money/quantities
 * are stored as numeric strings (.toString()) and surfaced as numbers (Number()).
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  clients,
  deliveryLines,
  deliveryNotes,
  docSequences,
  creditNotes,
  invoicePayments,
  salesAccountingEvents,
  invoiceLines,
  invoices,
  quoteLines,
  quotes,
} from '../../db/schema';
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
import { formatMoneyCents, parseMoneyCents } from './sales-money.domain';
import type {
  DeliveryNoteStatus,
  DocType,
  InvoiceStatus,
  QuoteStatus,
} from './sales.domain';
import type {
  ClientRecord,
  ClientStatus,
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
  CreditNoteRecord,
  LegalSellerSnapshot,
  UpdateInvoiceDraft,
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
type InvoicePaymentRow = typeof invoicePayments.$inferSelect;
type CreditNoteRow = typeof creditNotes.$inferSelect;

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The transaction handle drizzle passes to a `.transaction()` callback — the
 *  type the sequence-minting helper runs on so the counter bump commits (or
 *  rolls back) together with the document insert. */
type SalesTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleSalesRepository implements SalesRepository {
  constructor(private readonly db: Db) {}

  /**
   * Mints the next gap-free sequential reference for a document, inside the
   * caller's transaction. A single INSERT … ON CONFLICT DO UPDATE … RETURNING
   * atomically bumps sales.doc_sequence for (company, docType, exercice): the
   * first document of a fiscal year inserts last_number = 1, every next one
   * increments the stored value. Sharing the insert's transaction means a
   * rollback also unwinds the counter, so the sequence never skips a number
   * (art. 145 CGI). Concurrent inserts serialize on the conflicting PK row.
   */
  private async nextReference(
    tx: SalesTx,
    docType: DocType,
    date: Date,
  ): Promise<string> {
    const exercice = docExercice(date);
    const sequenceType: Record<DocType, string> = {
      devis: 'DEV',
      bl: 'BL',
      facture: 'FAC',
      avoir: 'AV',
    };
    const [row] = await tx
      .insert(docSequences)
      .values({
        companyId: 'agha-rm-infra',
        docType: sequenceType[docType],
        fiscalYear: exercice,
        lastValue: 1,
      })
      .onConflictDoUpdate({
        target: [
          docSequences.companyId,
          docSequences.docType,
          docSequences.fiscalYear,
        ],
        set: { lastValue: sql`${docSequences.lastValue} + 1` },
      })
      .returning({ lastValue: docSequences.lastValue });
    return formatDocReference(docType, exercice, Number(row?.lastValue ?? 1));
  }

  async upsertClient(input: UpsertClient): Promise<ClientRecord> {
    // One atomic INSERT … ON CONFLICT keyed on (company_id, name). The SET clause
    // is back-fill only — a non-null incoming value enriches the row, an incoming
    // null never erases what was stored. Mirrors InMemory.upsertClient.
    const [row] = await this.db
      .insert(clients)
      .values({
        name: input.name,
        clientType: input.clientType,
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
          clientType: sql`coalesce(excluded.client_type, ${clients.clientType})`,
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

  async listClients(paging: PageParams): Promise<Paged<ClientRecord>> {
    // DB-side page (ordered, LIMIT/OFFSET) + a count of the whole set so the
    // pager knows how many pages exist. Clients have no status filter.
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(clients)
        .orderBy(desc(clients.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: sql<number>`count(*)` }).from(clients),
    ]);
    return {
      items: rows.map(toClient),
      total: Number(countRow?.total ?? 0),
    };
  }

  async clientsSummary(): Promise<ClientSummary> {
    // Counts over the WHOLE set (not one page): a JS filter over a single page
    // would understate the actif/inactif cards.
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)`,
        activeCount: sql<number>`count(*) filter (where ${clients.status} = 'actif')`,
      })
      .from(clients);
    return {
      count: Number(row?.count ?? 0),
      activeCount: Number(row?.activeCount ?? 0),
    };
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
          reference: null,
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

  async listQuotes(
    filter: QuoteFilter,
    paging: PageParams,
  ): Promise<Paged<QuoteListItem>> {
    // DB-side page: projected (no `lines`), ordered, LIMIT/OFFSET — plus a count
    // of the whole filtered set for the pager. The list view never renders line
    // items, so the batched line fetch is dropped here.
    const where = quoteWhere(filter);
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(quotes)
        .where(where)
        .orderBy(desc(quotes.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: sql<number>`count(*)` }).from(quotes).where(where),
    ]);
    return {
      items: rows.map(toQuoteListItem),
      total: Number(countRow?.total ?? 0),
    };
  }

  async quotesSummary(filter: QuoteFilter): Promise<QuoteSummary> {
    // Totals over the WHOLE filtered set (not one page): a JS reduce over a
    // single page would understate them.
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)`,
        totalTtcMad: sql<string>`coalesce(sum(${quotes.totalTtcMad}), 0)`,
      })
      .from(quotes)
      .where(quoteWhere(filter));
    return {
      count: Number(row?.count ?? 0),
      totalTtcMad: Number(row?.totalTtcMad ?? 0),
    };
  }

  async getQuote(id: string): Promise<QuoteRecord | null> {
    const [row] = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row ? this.attachQuoteLines(row) : null;
  }

  async issueQuote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<QuoteRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${quotes} where id = ${id} for update`);
      const [existing] = await tx.select().from(quotes).where(eq(quotes.id, id)).limit(1);
      if (!existing) throw new Error('Devis introuvable.');
      const lineRows = await tx
        .select()
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, id))
        .orderBy(asc(quoteLines.orderIndex));
      if (existing.reference) return toQuote(existing, lineRows);
      if (existing.status !== 'brouillon') {
        throw new Error('Seul un devis brouillon peut être émis.');
      }
      const reference = await this.nextReference(tx, 'devis', existing.quoteDate);
      const snapshot = { quoteId: id, lines: lineRows };
      const [updated] = await tx
        .update(quotes)
        .set({
          reference,
          status: 'envoye',
          issuedAt,
          issuedBy: actor,
          legalSnapshot: {},
          contentHash: contentHash(snapshot),
          version: existing.version + 1,
        })
        .where(eq(quotes.id, id))
        .returning();
      if (!updated) throw new Error('Émission du devis impossible.');
      return toQuote(updated, lineRows);
    });
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
          reference: null,
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
    paging: PageParams,
  ): Promise<Paged<DeliveryNoteListItem>> {
    // DB-side page: projected (no `lines`), ordered, LIMIT/OFFSET — plus a count
    // of the whole filtered set for the pager. The list only shows a line COUNT,
    // so we fold it in via a correlated scalar subquery over delivery_line
    // (sales_delivery_line_delivery_note_id_idx) instead of loading line rows.
    const where = deliveryWhere(filter);
    const lineCount = sql<number>`(
      select count(*) from ${deliveryLines}
      where ${deliveryLines.deliveryNoteId} = ${deliveryNotes.id}
    )`;
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select({ note: deliveryNotes, lineCount })
        .from(deliveryNotes)
        .where(where)
        .orderBy(desc(deliveryNotes.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(deliveryNotes)
        .where(where),
    ]);
    return {
      items: rows.map((row) =>
        toDeliveryNoteListItem(row.note, Number(row.lineCount ?? 0)),
      ),
      total: Number(countRow?.total ?? 0),
    };
  }

  async getDeliveryNote(id: string): Promise<DeliveryNoteRecord | null> {
    const [row] = await this.db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, id))
      .limit(1);
    return row ? this.attachDeliveryLines(row) : null;
  }

  async issueDeliveryNote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<DeliveryNoteRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${deliveryNotes} where id = ${id} for update`,
      );
      const [existing] = await tx
        .select()
        .from(deliveryNotes)
        .where(eq(deliveryNotes.id, id))
        .limit(1);
      if (!existing) throw new Error('Bon de livraison introuvable.');
      const lineRows = await tx
        .select()
        .from(deliveryLines)
        .where(eq(deliveryLines.deliveryNoteId, id))
        .orderBy(asc(deliveryLines.orderIndex));
      if (existing.reference) return toDeliveryNote(existing, lineRows);
      if (existing.status !== 'brouillon') {
        throw new Error('Seul un bon de livraison brouillon peut être émis.');
      }
      const reference = await this.nextReference(tx, 'bl', existing.deliveryDate);
      const [updated] = await tx
        .update(deliveryNotes)
        .set({
          reference,
          status: 'livre',
          issuedAt,
          issuedBy: actor,
          legalSnapshot: {},
          contentHash: contentHash({ deliveryNoteId: id, lines: lineRows }),
          version: existing.version + 1,
        })
        .where(eq(deliveryNotes.id, id))
        .returning();
      if (!updated) throw new Error('Émission du bon de livraison impossible.');
      return toDeliveryNote(updated, lineRows);
    });
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
          reference: null,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          totalHtMad: totals.totalHtMad.toString(),
          tvaPct: input.tvaPct.toString(),
          tvaMad: totals.tvaMad.toString(),
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

  async issueInvoice(
    id: string,
    actor: string,
    issuedAt: Date,
    legalSnapshot: LegalSellerSnapshot,
  ): Promise<InvoiceRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${invoices} where id = ${id} for update`);
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1);
      if (!existing) throw new Error('Facture introuvable.');
      const lineRows = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id))
        .orderBy(asc(invoiceLines.orderIndex));
      if (existing.reference) return toInvoice(existing, lineRows);
      if (existing.status !== 'brouillon') {
        throw new Error('Seule une facture brouillon peut être émise.');
      }
      const reference = await this.nextReference(tx, 'facture', existing.invoiceDate);
      const [client] = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, existing.clientId))
        .limit(1);
      if (!client) throw new Error('Client de la facture introuvable.');
      const nextVersion = existing.version + 1;
      const [updated] = await tx
        .update(invoices)
        .set({
          reference,
          status: 'emise',
          issuedAt,
          issuedBy: actor,
          legalSnapshot: legalSnapshot as unknown as Record<string, unknown>,
          contentHash: contentHash({ invoiceId: id, legalSnapshot, lines: lineRows }),
          version: nextVersion,
        })
        .where(eq(invoices.id, id))
        .returning();
      if (!updated) throw new Error('Émission de la facture impossible.');
      await tx
        .insert(salesAccountingEvents)
        .values({
          eventKey: `invoice_issued:${id}:${nextVersion}`,
          eventType: 'invoice_issued',
          sourceType: 'invoice',
          sourceId: id,
          sourceVersion: nextVersion,
          occurredAt: issuedAt,
          payload: {
            invoiceId: id,
            reference,
            clientName: client.name,
            totalHtCents: parseMoneyCents(existing.totalHtMad),
            tvaCents: parseMoneyCents(existing.tvaMad),
            totalTtcCents: parseMoneyCents(existing.totalTtcMad),
          },
        })
        .onConflictDoNothing();
      return toInvoice(updated, lineRows);
    });
  }

  async updateDraftInvoice(
    id: string,
    input: UpdateInvoiceDraft,
  ): Promise<InvoiceRecord> {
    const [updated] = await this.db
      .update(invoices)
      .set({
        dueDate: input.dueDate,
        paymentTerms: input.paymentTerms,
        notes: input.notes,
        version: input.version + 1,
      })
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.status, 'brouillon'),
          eq(invoices.version, input.version),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error('Facture absente, déjà émise ou version obsolète.');
    }
    return this.attachInvoiceLines(updated);
  }

  async deleteDraftInvoice(id: string): Promise<void> {
    const deleted = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ status: invoices.status })
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1);
      if (!existing) return true;
      if (existing.status !== 'brouillon') return false;
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await tx.delete(invoices).where(eq(invoices.id, id));
      return true;
    });
    if (!deleted) throw new Error('Une facture émise ne peut plus être supprimée.');
  }

  private settlementFromRows(
    invoice: InvoiceRow,
    paymentRows: readonly InvoicePaymentRow[],
    creditRows: readonly CreditNoteRow[],
  ) {
    const summarized = summarizePaymentMovements(
      paymentRows.map((payment) => ({
        type: payment.movementType as 'encaissement' | 'remboursement',
        amountCents: parseMoneyCents(payment.amountMad),
      })),
    );
    const totalCents = parseMoneyCents(invoice.totalTtcMad);
    const legacyPaidOpening = invoice.legacyPaid && paymentRows.length === 0;
    return {
      legacyPaidOpening,
      settlement: deriveSettlement({
        totalCents,
        receivedCents: legacyPaidOpening ? totalCents : summarized.receivedCents,
        refundedCents: summarized.refundedCents,
        creditedCents: creditRows
          .filter((creditNote) => creditNote.status !== 'brouillon')
          .reduce(
            (total, creditNote) =>
              total + parseMoneyCents(creditNote.totalTtcMad),
            0,
          ),
      }),
    };
  }

  async getInvoiceAggregate(id: string): Promise<InvoiceAggregate | null> {
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!invoice) return null;
    const [lineRows, paymentRows, creditRows, [latestEvent]] = await Promise.all([
      this.db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id))
        .orderBy(asc(invoiceLines.orderIndex)),
      this.db
        .select()
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, id))
        .orderBy(asc(invoicePayments.createdAt)),
      this.db
        .select()
        .from(creditNotes)
        .where(eq(creditNotes.invoiceId, id))
        .orderBy(asc(creditNotes.createdAt)),
      this.db
        .select({ status: salesAccountingEvents.status })
        .from(salesAccountingEvents)
        .where(eq(salesAccountingEvents.sourceId, id))
        .orderBy(desc(salesAccountingEvents.occurredAt))
        .limit(1),
    ]);
    const derived = this.settlementFromRows(invoice, paymentRows, creditRows);
    return {
      invoice: toInvoice(invoice, lineRows),
      payments: paymentRows.map(toInvoicePayment),
      creditNotes: creditRows.map(toCreditNote),
      settlement: derived.settlement,
      accountingProjection:
        (latestEvent?.status as InvoiceAggregate['accountingProjection']) ??
        'pending',
      legacyPaidOpening: derived.legacyPaidOpening,
    };
  }

  async recordPayment(input: RecordInvoicePayment): Promise<InvoiceAggregate> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${invoices} where id = ${input.invoiceId} for update`,
      );
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1);
      if (!invoice || invoice.status === 'brouillon') {
        throw new Error('La facture doit être émise avant tout règlement.');
      }
      if (!invoice.reference) throw new Error('Référence de facture manquante.');
      const [client] = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, invoice.clientId))
        .limit(1);
      if (!client) throw new Error('Client de la facture introuvable.');
      const [paymentRows, creditRows] = await Promise.all([
        tx.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, input.invoiceId)),
        tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, input.invoiceId)),
      ]);
      const duplicate = paymentRows.some(
        (payment) => payment.idempotencyKey === input.idempotencyKey,
      );
      if (duplicate) return;
      const { settlement } = this.settlementFromRows(
        invoice,
        paymentRows,
        creditRows,
      );
      if (
        !Number.isSafeInteger(input.amountCents) ||
        input.amountCents <= 0 ||
        input.amountCents > settlement.outstandingCents
      ) {
        throw new Error('Le règlement dépasse le solde restant ou est invalide.');
      }
      const summarizedBefore = summarizePaymentMovements(
        paymentRows.map((payment) => ({
          type: payment.movementType as 'encaissement' | 'remboursement',
          amountCents: parseMoneyCents(payment.amountMad),
        })),
      );
      const previouslyReceivedCents =
        summarizedBefore.receivedCents - summarizedBefore.refundedCents;
      const invoiceTtcCents = parseMoneyCents(invoice.totalTtcMad);
      const invoiceTvaCents = parseMoneyCents(invoice.tvaMad);
      const transferredAt = (receivedCents: number) =>
        receivedCents >= invoiceTtcCents
          ? invoiceTvaCents
          : Number(
              (BigInt(invoiceTvaCents) * BigInt(receivedCents)) /
                BigInt(invoiceTtcCents),
            );
      const previouslyTransferredTvaCents = transferredAt(
        previouslyReceivedCents,
      );
      const paymentTvaCents =
        transferredAt(previouslyReceivedCents + input.amountCents) -
        previouslyTransferredTvaCents;
      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId: input.invoiceId,
          movementType: 'encaissement',
          reason: 'reglement_client',
          amountMad: formatMoneyCents(input.amountCents),
          method: input.method,
          treasuryAccount: input.treasuryAccount,
          valueDate: input.valueDate,
          reference: input.reference,
          tvaTransferredMad: formatMoneyCents(paymentTvaCents),
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        })
        .returning({ id: invoicePayments.id, createdAt: invoicePayments.createdAt });
      if (!payment) throw new Error('Enregistrement du règlement impossible.');
      await tx
        .insert(salesAccountingEvents)
        .values({
          eventKey: `payment_recorded:${payment.id}`,
          eventType: 'payment_recorded',
          sourceType: 'invoice',
          sourceId: input.invoiceId,
          sourceVersion: paymentRows.length + 1,
          occurredAt: payment.createdAt,
          payload: {
            invoiceId: input.invoiceId,
            paymentId: payment.id,
            reference: invoice.reference,
            clientName: client.name,
            amountCents: input.amountCents,
            invoiceTtcCents,
            invoiceTvaCents,
            previouslyReceivedCents,
            previouslyTransferredTvaCents,
            treasuryAccount: input.treasuryAccount,
          },
        })
        .onConflictDoNothing();
    });
    return (await this.getInvoiceAggregate(input.invoiceId))!;
  }

  async reversePayment(input: ReverseInvoicePayment): Promise<InvoiceAggregate> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${invoices} where id = ${input.invoiceId} for update`,
      );
      const [original] = await tx
        .select()
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.id, input.paymentId),
            eq(invoicePayments.invoiceId, input.invoiceId),
          ),
        )
        .limit(1);
      if (!original || original.movementType !== 'encaissement') {
        throw new Error('Règlement original introuvable.');
      }
      const [[invoice], [client], [originalEvent]] = await Promise.all([
        tx
          .select()
          .from(invoices)
          .where(eq(invoices.id, input.invoiceId))
          .limit(1),
        tx
          .select({ name: clients.name })
          .from(clients)
          .innerJoin(invoices, eq(invoices.clientId, clients.id))
          .where(eq(invoices.id, input.invoiceId))
          .limit(1),
        tx
          .select({ payload: salesAccountingEvents.payload })
          .from(salesAccountingEvents)
          .where(
            eq(salesAccountingEvents.eventKey, `payment_recorded:${original.id}`),
          )
          .limit(1),
      ]);
      if (!invoice?.reference || !client || !originalEvent) {
        throw new Error('Contexte du règlement original incomplet.');
      }
      const [existing] = await tx
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(eq(invoicePayments.originalMovementId, input.paymentId))
        .limit(1);
      if (existing) return;
      const [reversal] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId: input.invoiceId,
          movementType: 'remboursement',
          reason: 'contrepassation',
          amountMad: original.amountMad,
          method: original.method,
          treasuryAccount: original.treasuryAccount,
          valueDate: input.valueDate,
          originalMovementId: original.id,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        })
        .returning({ id: invoicePayments.id, createdAt: invoicePayments.createdAt });
      if (!reversal) throw new Error('Contrepassation impossible.');
      await tx
        .insert(salesAccountingEvents)
        .values({
          eventKey: `payment_reversed:${reversal.id}`,
          eventType: 'payment_reversed',
          sourceType: 'invoice',
          sourceId: input.invoiceId,
          sourceVersion: 1,
          occurredAt: reversal.createdAt,
          payload: {
            invoiceId: input.invoiceId,
            paymentId: original.id,
            reversalId: reversal.id,
            ...originalEvent.payload,
            reference: invoice.reference,
            clientName: client.name,
            treasuryAccount: original.treasuryAccount,
          },
        })
        .onConflictDoNothing();
    });
    return (await this.getInvoiceAggregate(input.invoiceId))!;
  }

  async createCreditNote(input: CreateCreditNote): Promise<CreditNoteRecord> {
    const totalTtcCents = input.totalHtCents + input.tvaCents;
    if (
      !Number.isSafeInteger(totalTtcCents) ||
      input.totalHtCents < 0 ||
      input.tvaCents < 0 ||
      totalTtcCents <= 0
    ) {
      throw new Error('Le montant de l’avoir est invalide.');
    }
    const [row] = await this.db
      .insert(creditNotes)
      .values({
        invoiceId: input.invoiceId,
        creditDate: input.creditDate,
        totalHtMad: formatMoneyCents(input.totalHtCents),
        tvaPct: '0',
        tvaMad: formatMoneyCents(input.tvaCents),
        totalTtcMad: formatMoneyCents(totalTtcCents),
        reason: input.reason,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error('Création de l’avoir impossible.');
    return toCreditNote(row);
  }

  async issueCreditNote(
    id: string,
    actor: string,
    issuedAt: Date,
  ): Promise<CreditNoteRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${creditNotes} where id = ${id} for update`);
      const [existing] = await tx
        .select()
        .from(creditNotes)
        .where(eq(creditNotes.id, id))
        .limit(1);
      if (!existing) throw new Error('Avoir introuvable.');
      if (existing.reference) return toCreditNote(existing);
      await tx.execute(
        sql`select id from ${invoices} where id = ${existing.invoiceId} for update`,
      );
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, existing.invoiceId))
        .limit(1);
      if (!invoice || invoice.status === 'brouillon') {
        throw new Error('La facture liée doit être émise.');
      }
      const [paymentRows, creditRows] = await Promise.all([
        tx.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoice.id)),
        tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, invoice.id)),
      ]);
      const summarized = summarizePaymentMovements(
        paymentRows.map((payment) => ({
          type: payment.movementType as 'encaissement' | 'remboursement',
          amountCents: parseMoneyCents(payment.amountMad),
        })),
      );
      const allocation = allocateCreditNote({
        invoiceTotalCents: parseMoneyCents(invoice.totalTtcMad),
        previouslyCreditedCents: creditRows
          .filter((creditNote) => creditNote.status !== 'brouillon')
          .reduce(
            (total, creditNote) =>
              total + parseMoneyCents(creditNote.totalTtcMad),
            0,
          ),
        netReceivedCents:
          summarized.receivedCents - summarized.refundedCents,
        requestedCreditCents: parseMoneyCents(existing.totalTtcMad),
      });
      const [client] = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, invoice.clientId))
        .limit(1);
      if (!client) throw new Error('Client de la facture introuvable.');
      const invoiceTtcCents = parseMoneyCents(invoice.totalTtcMad);
      const invoiceTvaCents = parseMoneyCents(invoice.tvaMad);
      const netReceivedCents =
        summarized.receivedCents - summarized.refundedCents;
      const transferredTvaCents =
        netReceivedCents >= invoiceTtcCents
          ? invoiceTvaCents
          : Number(
              (BigInt(invoiceTvaCents) * BigInt(netReceivedCents)) /
                BigInt(invoiceTtcCents),
            );
      const reversedPendingCents = creditRows
        .filter((creditNote) => creditNote.status !== 'brouillon')
        .reduce(
          (total, creditNote) =>
            total + parseMoneyCents(creditNote.reversedPendingTvaMad),
          0,
        );
      const reversedDueCents = creditRows
        .filter((creditNote) => creditNote.status !== 'brouillon')
        .reduce(
          (total, creditNote) =>
            total + parseMoneyCents(creditNote.reversedDueTvaMad),
          0,
        );
      const availablePendingTvaCents = Math.max(
        0,
        invoiceTvaCents - transferredTvaCents - reversedPendingCents,
      );
      const availableDueTvaCents = Math.max(
        0,
        transferredTvaCents - reversedDueCents,
      );
      const outstandingBeforeCreditCents = this.settlementFromRows(
        invoice,
        paymentRows,
        creditRows,
      ).settlement.outstandingCents;
      const reference = await this.nextReference(tx, 'avoir', existing.creditDate);
      const nextVersion = existing.version + 1;
      const [updated] = await tx
        .update(creditNotes)
        .set({
          reference,
          status: 'emise',
          issuedAt,
          issuedBy: actor,
          legalSnapshot: invoice.legalSnapshot ?? {},
          contentHash: contentHash({ creditNoteId: id, invoiceId: invoice.id }),
          againstOutstandingMad: formatMoneyCents(
            allocation.againstOutstandingCents,
          ),
          againstCollectedMad: formatMoneyCents(
            allocation.againstCollectedCents,
          ),
          reversedPendingTvaMad: existing.tvaMad,
          reversedDueTvaMad: '0.00',
          version: nextVersion,
        })
        .where(eq(creditNotes.id, id))
        .returning();
      if (!updated) throw new Error('Émission de l’avoir impossible.');
      await tx
        .insert(salesAccountingEvents)
        .values({
          eventKey: `credit_note_issued:${id}:${nextVersion}`,
          eventType: 'credit_note_issued',
          sourceType: 'credit_note',
          sourceId: id,
          sourceVersion: nextVersion,
          occurredAt: issuedAt,
          payload: {
            creditNoteId: id,
            invoiceId: invoice.id,
            reference,
            clientName: client.name,
            totalHtCents: parseMoneyCents(existing.totalHtMad),
            tvaCents: parseMoneyCents(existing.tvaMad),
            totalTtcCents: parseMoneyCents(existing.totalTtcMad),
            againstOutstandingCents: allocation.againstOutstandingCents,
            againstCollectedCents: allocation.againstCollectedCents,
            outstandingBeforeCreditCents,
            availablePendingTvaCents,
            availableDueTvaCents,
          },
        })
        .onConflictDoNothing();
      return toCreditNote(updated);
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
    clientType: row.clientType as ClientRecord['clientType'],
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
    ...toQuoteListItem(row),
    lines: lineRows.map(toDocLine),
  };
}

/** List projection — every quote field except the `lines` array. */
function toQuoteListItem(row: QuoteRow): QuoteListItem {
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
    issuedAt: row.issuedAt ?? undefined,
    issuedBy: row.issuedBy ?? undefined,
    legalSnapshot: row.legalSnapshot as unknown as LegalSellerSnapshot | undefined,
    version: row.version,
    createdAt: row.createdAt,
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
    issuedAt: row.issuedAt ?? undefined,
    issuedBy: row.issuedBy ?? undefined,
    legalSnapshot: row.legalSnapshot as unknown as LegalSellerSnapshot | undefined,
    version: row.version,
    createdAt: row.createdAt,
    lines: lineRows.map(toDeliveryLine),
  };
}

/** List projection — the note minus `lines`, carrying only the line count the
 *  list column renders. */
function toDeliveryNoteListItem(
  row: DeliveryNoteRow,
  lineCount: number,
): DeliveryNoteListItem {
  return {
    id: row.id,
    clientId: row.clientId,
    projectId: row.projectId ?? undefined,
    quoteId: row.quoteId ?? undefined,
    reference: row.reference,
    deliveryDate: row.deliveryDate,
    status: row.status as DeliveryNoteRecord['status'],
    notes: row.notes ?? undefined,
    issuedAt: row.issuedAt ?? undefined,
    issuedBy: row.issuedBy ?? undefined,
    legalSnapshot: row.legalSnapshot as unknown as LegalSellerSnapshot | undefined,
    version: row.version,
    createdAt: row.createdAt,
    lineCount,
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
    status: row.status as InvoiceRecord['status'],
    totalHtMad: Number(row.totalHtMad),
    tvaPct: Number(row.tvaPct),
    tvaMad: Number(row.tvaMad),
    totalTtcMad: Number(row.totalTtcMad),
    paidAt: row.paidAt ?? undefined,
    notes: row.notes ?? undefined,
    paymentTerms: row.paymentTerms ?? undefined,
    issuedAt: row.issuedAt ?? undefined,
    issuedBy: row.issuedBy ?? undefined,
    legalSnapshot: row.legalSnapshot as unknown as LegalSellerSnapshot | undefined,
    version: row.version,
    legacyPaid: row.legacyPaid,
    createdAt: row.createdAt,
  };
}

function toInvoicePayment(row: InvoicePaymentRow): InvoicePaymentRecord {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    movementType: row.movementType as InvoicePaymentRecord['movementType'],
    amountCents: parseMoneyCents(row.amountMad),
    method: row.method,
    treasuryAccount: row.treasuryAccount,
    valueDate: row.valueDate,
    originalMovementId: row.originalMovementId ?? undefined,
    reference: row.reference ?? undefined,
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toCreditNote(row: CreditNoteRow): CreditNoteRecord {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    reference: row.reference,
    status: row.status as CreditNoteRecord['status'],
    creditDate: row.creditDate,
    totalHtCents: parseMoneyCents(row.totalHtMad),
    tvaCents: parseMoneyCents(row.tvaMad),
    totalTtcCents: parseMoneyCents(row.totalTtcMad),
    againstOutstandingCents: parseMoneyCents(row.againstOutstandingMad),
    againstCollectedCents: parseMoneyCents(row.againstCollectedMad),
    reason: row.reason,
    issuedAt: row.issuedAt ?? undefined,
    issuedBy: row.issuedBy ?? undefined,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
