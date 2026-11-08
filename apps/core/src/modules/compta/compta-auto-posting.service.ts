import { Inject, Injectable } from '@nestjs/common';
import {
  buildCreditNotePosting,
  buildInvoiceIssuePosting,
  type FaitGenerateurTva,
  type PostingResult,
  type SalesPostingAccounts,
} from './compta-ventes.domain';
import type { VentePostingResult } from './compta-ventes.domain';
import type { ReglementMethod } from './compta-reglements.domain';
import {
  buildPaymentReversalPosting,
  buildReceiptPosting,
  buildRefundPosting,
} from './compta-reglements.domain';

export type ReconciliationStatus = 'pending' | 'projected' | 'blocked';

export interface SalesAccountingEvent {
  id: string;
  eventKey: string;
  eventType: string;
  sourceId: string;
  sourceVersion: number;
  occurredAt: Date;
  payload: Record<string, unknown>;
  status: ReconciliationStatus;
  attempts: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  accountingEntryId?: string;
}

export interface ReconciliationFilters {
  ids?: string[];
  year?: number;
  statuses?: ReconciliationStatus[];
}

export interface SalesAccountingEventStore {
  getEvent(id: string): Promise<SalesAccountingEvent | null>;
  listReconciliation(
    filters: ReconciliationFilters,
  ): Promise<SalesAccountingEvent[]>;
  markProjected(id: string, entryId: string): Promise<SalesAccountingEvent>;
  markBlocked(
    id: string,
    code: string,
    message: string,
  ): Promise<SalesAccountingEvent>;
  markRetryableFailure(
    id: string,
    code: string,
    message: string,
  ): Promise<SalesAccountingEvent>;
}

export interface AccountingProjectionContext {
  faitGenerateurTva: FaitGenerateurTva;
  exerciseOpen: boolean;
  accounts: SalesPostingAccounts;
}

export interface DraftAccountingEntry {
  id: string;
  status: 'brouillon' | 'validee';
}

export interface AccountingProjectionPort {
  getContext(event: SalesAccountingEvent): Promise<AccountingProjectionContext>;
  findEntryByEvent(eventKey: string): Promise<DraftAccountingEntry | null>;
  createDraftEntry(
    event: SalesAccountingEvent,
    posting: Extract<PostingResult, { kind: 'ready' }>,
    actor: string,
  ): Promise<DraftAccountingEntry>;
}

export const SALES_ACCOUNTING_EVENT_STORE = Symbol(
  'SALES_ACCOUNTING_EVENT_STORE',
);
export const ACCOUNTING_PROJECTION_PORT = Symbol('ACCOUNTING_PROJECTION_PORT');

export interface ReconciliationSummary {
  projected: number;
  blocked: number;
  pending: number;
  records: SalesAccountingEvent[];
}

function cents(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Payload comptable invalide: ${key}.`);
  }
  return Number(value);
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Payload comptable invalide: ${key}.`);
  }
  return value;
}

@Injectable()
export class ComptaAutoPostingService {
  constructor(
    @Inject(SALES_ACCOUNTING_EVENT_STORE)
    private readonly events: SalesAccountingEventStore,
    @Inject(ACCOUNTING_PROJECTION_PORT)
    private readonly projection: AccountingProjectionPort,
  ) {}

  async projectEvent(
    eventId: string,
    actor: string,
  ): Promise<SalesAccountingEvent> {
    const event = await this.events.getEvent(eventId);
    if (!event) throw new Error('Événement comptable introuvable.');
    if (event.status === 'projected' && event.accountingEntryId) return event;

    const existing = await this.projection.findEntryByEvent(event.eventKey);
    if (existing) return this.events.markProjected(event.id, existing.id);

    const context = await this.projection.getContext(event);
    if (!context.exerciseOpen) {
      return this.events.markBlocked(
        event.id,
        'exercice_cloture',
        'L’exercice comptable de l’événement est clôturé.',
      );
    }

    let posting: PostingResult;
    try {
      posting = this.buildPosting(event, context);
    } catch (error) {
      return this.events.markBlocked(event.id, 'payload_invalide',
        error instanceof Error ? error.message : 'Payload comptable invalide.');
    }
    if (posting.kind === 'blocked') {
      return this.events.markBlocked(event.id, posting.code, posting.message);
    }

    try {
      const entry = await this.projection.createDraftEntry(
        event,
        posting,
        actor,
      );
      return this.events.markProjected(event.id, entry.id);
    } catch (error) {
      return this.events.markRetryableFailure(
        event.id,
        'projection_transitoire',
        error instanceof Error ? error.message : 'Échec transitoire inconnu.',
      );
    }
  }

  private buildPosting(
    event: SalesAccountingEvent,
    context: AccountingProjectionContext,
  ): PostingResult {
    const reference = text(event.payload, 'reference');
    const clientName = text(event.payload, 'clientName');
    if (event.eventType === 'invoice_issued') {
      return buildInvoiceIssuePosting({
        reference,
        clientName,
        totalHtCents: cents(event.payload, 'totalHtCents'),
        tvaCents: cents(event.payload, 'tvaCents'),
        totalTtcCents: cents(event.payload, 'totalTtcCents'),
        faitGenerateurTva: context.faitGenerateurTva,
        accounts: context.accounts,
      });
    }
    if (event.eventType === 'payment_recorded') {
      return buildReceiptPosting({
        invoiceReference: reference,
        clientName,
        faitGenerateurTva: context.faitGenerateurTva,
        amountCents: cents(event.payload, 'amountCents'),
        invoiceTtcCents: cents(event.payload, 'invoiceTtcCents'),
        invoiceTvaCents: cents(event.payload, 'invoiceTvaCents'),
        previouslyReceivedCents: cents(event.payload, 'previouslyReceivedCents'),
        previouslyTransferredTvaCents: cents(
          event.payload,
          'previouslyTransferredTvaCents',
        ),
        receiptTvaCents: event.payload.receiptTvaCents === undefined
          ? undefined : cents(event.payload, 'receiptTvaCents'),
        treasuryAccount: text(event.payload, 'treasuryAccount'),
        accounts: context.accounts,
      });
    }
    if (event.eventType === 'payment_reversed') {
      const original = buildReceiptPosting({
        invoiceReference: reference,
        clientName,
        faitGenerateurTva: context.faitGenerateurTva,
        amountCents: cents(event.payload, 'amountCents'),
        invoiceTtcCents: cents(event.payload, 'invoiceTtcCents'),
        invoiceTvaCents: cents(event.payload, 'invoiceTvaCents'),
        previouslyReceivedCents: cents(event.payload, 'previouslyReceivedCents'),
        previouslyTransferredTvaCents: cents(
          event.payload,
          'previouslyTransferredTvaCents',
        ),
        receiptTvaCents: event.payload.receiptTvaCents === undefined
          ? undefined : cents(event.payload, 'receiptTvaCents'),
        treasuryAccount: text(event.payload, 'treasuryAccount'),
        accounts: context.accounts,
      });
      return original.kind === 'ready'
        ? buildPaymentReversalPosting({
            invoiceReference: reference,
            originalLines: original.lines,
          })
        : original;
    }
    if (event.eventType === 'refund_recorded') {
      return buildRefundPosting({
        invoiceReference: reference,
        clientName,
        amountCents: cents(event.payload, 'amountCents'),
        treasuryAccount: text(event.payload, 'treasuryAccount'),
        accounts: context.accounts,
      });
    }
    if (event.eventType === 'credit_note_issued') {
      return buildCreditNotePosting({
        reference,
        clientName,
        faitGenerateurTva: context.faitGenerateurTva,
        totalHtCents: cents(event.payload, 'totalHtCents'),
        tvaCents: cents(event.payload, 'tvaCents'),
        totalTtcCents: cents(event.payload, 'totalTtcCents'),
        againstOutstandingCents: cents(
          event.payload,
          'againstOutstandingCents',
        ),
        againstCollectedCents: cents(event.payload, 'againstCollectedCents'),
        outstandingBeforeCreditCents: cents(
          event.payload,
          'outstandingBeforeCreditCents',
        ),
        availablePendingTvaCents: cents(
          event.payload,
          'availablePendingTvaCents',
        ),
        availableDueTvaCents: cents(event.payload, 'availableDueTvaCents') +
          (context.faitGenerateurTva === 'debits'
            ? cents(event.payload, 'availablePendingTvaCents') : 0),
        accounts: context.accounts,
      });
    }
    return {
      kind: 'blocked',
      code: 'compte_manquant',
      message: `Type d’événement non pris en charge: ${event.eventType}.`,
    };
  }

  async listSalesReconciliation(
    filters: ReconciliationFilters,
  ): Promise<SalesAccountingEvent[]> {
    return this.events.listReconciliation(filters);
  }

  async reconcileSalesEvents(input: {
    ids?: string[];
    year?: number;
    actor: string;
  }): Promise<ReconciliationSummary> {
    const candidates = await this.events.listReconciliation({
      ids: input.ids,
      year: input.year,
      statuses: input.ids ? undefined : ['pending', 'blocked'],
    });
    const records: SalesAccountingEvent[] = [];
    for (const event of candidates) {
      records.push(await this.projectEvent(event.id, input.actor));
    }
    return {
      projected: records.filter((record) => record.status === 'projected').length,
      blocked: records.filter((record) => record.status === 'blocked').length,
      pending: records.filter((record) => record.status === 'pending').length,
      records,
    };
  }

  /** @deprecated The issue endpoint now persists an event and reconciles by ID. */
  async onInvoiceConfirmed(
    _invoiceId: string,
    _actor: string | null,
  ): Promise<VentePostingResult> {
    return { created: false, reason: 'already_posted' };
  }

  /** @deprecated Payments are projected from their durable event. */
  async onInvoicePaid(
    _invoiceId: string,
    _actor: string | null,
    _method?: ReglementMethod,
  ): Promise<VentePostingResult> {
    return { created: false, reason: 'already_posted' };
  }
}
