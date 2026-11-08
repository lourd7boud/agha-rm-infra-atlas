'use server';

import { revalidatePath } from 'next/cache';
import { AtlasApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';

export interface SalesActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

type SalesOperation =
  | 'issueInvoice'
  | 'updateInvoice'
  | 'deleteInvoice'
  | 'recordPayment'
  | 'reversePayment'
  | 'createCreditNote'
  | 'issueCreditNote'
  | 'issueQuote'
  | 'issueDeliveryNote';

const KNOWN_ERROR_MESSAGES: Record<SalesOperation, string> = {
  issueInvoice:
    'Émission refusée. Vérifiez les données légales du vendeur et du client.',
  updateInvoice:
    'Modification refusée. Rechargez le brouillon avant de réessayer.',
  deleteInvoice: 'Suppression refusée. Seul un brouillon peut être supprimé.',
  recordPayment: 'Encaissement refusé. Vérifiez le montant et les informations.',
  reversePayment: 'Annulation du règlement refusée.',
  createCreditNote: 'Création de l’avoir refusée. Vérifiez les montants.',
  issueCreditNote: 'Émission de l’avoir refusée.',
  issueQuote: 'Émission du devis refusée.',
  issueDeliveryNote: 'Émission du bon de livraison refusée.',
};

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === 'string' ? raw.trim() : '';
}

function optionalValue(formData: FormData, key: string): string | undefined {
  return value(formData, key) || undefined;
}

function integer(formData: FormData, key: string): number {
  return Number(value(formData, key));
}

function madToCents(raw: string): number {
  const normalized = raw.replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return Number.NaN;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : Number.NaN;
}

function centsFromForm(formData: FormData, centsKey: string, madKey: string): number {
  const explicitCents = value(formData, centsKey);
  return explicitCents ? Number(explicitCents) : madToCents(value(formData, madKey));
}

function knownFailure(
  operation: SalesOperation,
  error: unknown,
): SalesActionState | null {
  if (
    error instanceof AtlasApiError &&
    [400, 403, 404, 409, 422].includes(error.status)
  ) {
    return { status: 'error', message: KNOWN_ERROR_MESSAGES[operation] };
  }
  return null;
}

async function mutate(
  operation: SalesOperation,
  work: () => Promise<unknown>,
  paths: readonly string[],
): Promise<SalesActionState> {
  try {
    await work();
    for (const path of paths) revalidatePath(path);
    return { status: 'success' };
  } catch (error) {
    const known = knownFailure(operation, error);
    if (known) return known;
    throw error;
  }
}

function invoicePaths(id: string): string[] {
  return [
    '/sales/invoices',
    `/sales/invoices/${id}`,
    `/sales/invoices/${id}/print`,
    '/compta/ecritures',
    '/compta/a-valider',
  ];
}

export async function issueInvoice(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'invoiceId');
  return mutate(
    'issueInvoice',
    () => apiPost(`/sales/invoices/${id}/issue`, {}),
    invoicePaths(id),
  );
}

export async function updateInvoiceDraft(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'invoiceId');
  return mutate(
    'updateInvoice',
    () =>
      apiPatch(`/sales/invoices/${id}`, {
        version: integer(formData, 'version'),
        dueDate: optionalValue(formData, 'dueDate'),
        paymentTerms: optionalValue(formData, 'paymentTerms'),
        notes: optionalValue(formData, 'notes'),
      }),
    invoicePaths(id),
  );
}

export async function deleteInvoiceDraft(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'invoiceId');
  return mutate(
    'deleteInvoice',
    () => apiDelete(`/sales/invoices/${id}`),
    invoicePaths(id),
  );
}

export async function recordInvoicePayment(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'invoiceId');
  return mutate(
    'recordPayment',
    () =>
      apiPost(`/sales/invoices/${id}/payments`, {
        amountCents: centsFromForm(formData, 'amountCents', 'amountMad'),
        method: value(formData, 'method'),
        treasuryAccount: value(formData, 'treasuryAccount'),
        valueDate: value(formData, 'valueDate'),
        reference: optionalValue(formData, 'reference'),
        idempotencyKey: value(formData, 'idempotencyKey'),
      }),
    invoicePaths(id),
  );
}

export async function reverseInvoicePayment(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const invoiceId = value(formData, 'invoiceId');
  const paymentId = value(formData, 'paymentId');
  return mutate(
    'reversePayment',
    () =>
      apiPost(`/sales/invoices/${invoiceId}/payments/${paymentId}/reverse`, {
        valueDate: value(formData, 'valueDate'),
        idempotencyKey: value(formData, 'idempotencyKey'),
      }),
    invoicePaths(invoiceId),
  );
}

export async function createInvoiceCreditNote(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const invoiceId = value(formData, 'invoiceId');
  return mutate(
    'createCreditNote',
    () =>
      apiPost(`/sales/invoices/${invoiceId}/credit-notes`, {
        creditDate: value(formData, 'creditDate'),
        totalHtCents: centsFromForm(formData, 'totalHtCents', 'totalHtMad'),
        tvaCents: centsFromForm(formData, 'tvaCents', 'tvaMad'),
        reason: value(formData, 'reason'),
      }),
    invoicePaths(invoiceId),
  );
}

export async function issueInvoiceCreditNote(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const invoiceId = value(formData, 'invoiceId');
  const creditNoteId = value(formData, 'creditNoteId');
  return mutate(
    'issueCreditNote',
    () => apiPost(`/sales/credit-notes/${creditNoteId}/issue`, {}),
    invoicePaths(invoiceId),
  );
}

export async function issueQuote(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'quoteId');
  return mutate(
    'issueQuote',
    () => apiPost(`/sales/quotes/${id}/issue`, {}),
    ['/sales/quotes', `/sales/quotes/${id}`, `/sales/quotes/${id}/print`],
  );
}

export async function issueDeliveryNote(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const id = value(formData, 'deliveryNoteId');
  return mutate(
    'issueDeliveryNote',
    () => apiPost(`/sales/delivery-notes/${id}/issue`, {}),
    [
      '/sales/delivery-notes',
      `/sales/delivery-notes/${id}`,
      `/sales/delivery-notes/${id}/print`,
    ],
  );
}
