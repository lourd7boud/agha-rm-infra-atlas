import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, AtlasApiError } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  INVOICE_STATUS_BADGES,
  tvaMad,
  type ClientRecord,
  type InvoiceRecord,
  type InvoiceStatus,
} from '@/lib/sales';

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function failToInvoice(id: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[invoices/${id}] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code =
    status === 409 ? 'conflict' : status === 400 ? 'invalid' : 'failed';
  redirect(`/sales/invoices/${id}?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'setStatus:conflict': 'Action refusée : la facture est déjà annulée.',
  'setStatus:invalid': 'Statut refusé : transition non autorisée.',
  'setStatus:failed': 'Échec du changement de statut. Réessayez.',
};

function actionErrorMessage(
  error: string | undefined,
  code: string | undefined,
): string | undefined {
  if (!error) return undefined;
  return (
    ACTION_ERROR_MESSAGES[`${error}:${code ?? 'failed'}`] ??
    'Une erreur est survenue. Réessayez.'
  );
}

// Status transitions offered from the current state. brouillon/envoyee are the
// only mutable states; payee and annulee are terminal (the backend rejects
// changes to an annulee with 409). Mirrors the PATCH /sales/invoices/:id/status
// enum exactly.
const NEXT_INVOICE_ACTIONS: Partial<
  Record<InvoiceStatus, { to: InvoiceStatus; label: string; tone: string }[]>
> = {
  brouillon: [
    {
      to: 'envoyee',
      label: 'Marquer envoyée',
      tone: 'bg-cyan-deep text-paper hover:bg-cyan',
    },
    {
      to: 'payee',
      label: 'Marquer payée',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
    {
      to: 'annulee',
      label: 'Annuler',
      tone: 'border border-line-2 text-muted hover:bg-sand',
    },
  ],
  envoyee: [
    {
      to: 'payee',
      label: 'Marquer payée',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
    {
      to: 'annulee',
      label: 'Annuler',
      tone: 'border border-line-2 text-muted hover:bg-sand',
    },
  ],
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const invoice = await apiGet<InvoiceRecord>(`/sales/invoices/${id}`);
  const client = await apiGet<ClientRecord>(`/sales/clients/${invoice.clientId}`);
  const badge = INVOICE_STATUS_BADGES[invoice.status];
  const actions = NEXT_INVOICE_ACTIONS[invoice.status] ?? [];

  async function setStatus(formData: FormData) {
    'use server';
    const to = String(formData.get('to') ?? '');
    try {
      await apiPatch(`/sales/invoices/${id}/status`, { status: to });
    } catch (error) {
      failToInvoice(id, 'setStatus', error);
    }
    revalidatePath(`/sales/invoices/${id}`);
    revalidatePath('/sales/invoices');
  }

  return (
    <div>
      <Link href="/sales/invoices" className="text-sm text-muted hover:text-ink">
        ← Factures
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{invoice.reference}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
        <Link
          href={`/sales/invoices/${invoice.id}/print`}
          className="ml-auto rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan"
        >
          Imprimer / PDF
        </Link>
      </div>
      <p className="mb-8 text-sm text-muted">
        {client.name} — émise le {fmtDate(invoice.invoiceDate)}
        {invoice.dueDate ? ` · échéance ${fmtDate(invoice.dueDate)}` : ''}
        {invoice.paidAt ? ` · réglée le ${fmtDate(invoice.paidAt)}` : ''}
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Total HT
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(invoice.totalHtMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            TVA ({invoice.tvaPct}%)
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(tvaMad(invoice))}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Total TTC
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums text-cyan">
            {fmtMad(invoice.totalTtcMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Client
          </p>
          <p className="mt-2 font-semibold">{client.name}</p>
          {client.city && <p className="text-sm text-muted">{client.city}</p>}
        </div>
      </div>

      {actions.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-3">
          {actions.map((action) => (
            <form key={action.to} action={setStatus}>
              <input type="hidden" name="to" value={action.to} />
              <button
                className={`rounded-md px-4 py-2 text-sm font-semibold transition ${action.tone}`}
              >
                {action.label}
              </button>
            </form>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Lignes ({invoice.lines.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3 text-right">P.U.</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3 font-semibold">{line.designation}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtQtyUnit(line.quantity, line.unit)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                  {fmtMad(line.unitPriceMad)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                  {fmtMad(line.lineTotalMad)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line text-sm">
            <tr>
              <td className="px-4 py-2.5 text-right text-muted" colSpan={3}>
                Total HT
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                {fmtMad(invoice.totalHtMad)}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-right text-muted" colSpan={3}>
                TVA ({invoice.tvaPct}%)
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                {fmtMad(tvaMad(invoice))}
              </td>
            </tr>
            <tr>
              <td
                className="px-4 py-2.5 text-right font-semibold"
                colSpan={3}
              >
                Total TTC
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-cyan">
                {fmtMad(invoice.totalTtcMad)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {invoice.notes && (
        <section className="mt-6 rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">
            Notes
          </h2>
          <p className="text-sm text-ink-2">{invoice.notes}</p>
        </section>
      )}
    </div>
  );
}
