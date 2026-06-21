import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { LineEditor } from '@/components/sales/LineEditor';
import {
  fmtDate,
  fmtMad,
  INVOICE_STATUS_BADGES,
  INVOICE_STATUS_OPTIONS,
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

function failToInvoices(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[invoices] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : status === 404 ? 'invalid' : 'failed';
  redirect(`/sales/invoices?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createInvoice:invalid':
    'Facture refusée : client, référence, date, TVA (0–100%) et au moins une ligne valide sont requis.',
  'createInvoice:failed': 'Échec de l’enregistrement de la facture. Réessayez.',
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

interface PricedLineInput {
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  orderIndex: number;
}

function parsePricedLines(raw: string): PricedLineInput[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const lines = parsed.map((item, index) => {
      const row = item as Record<string, unknown>;
      const designation = String(row.designation ?? '').trim();
      const quantity = Number(row.quantity);
      const unitPriceMad = Number(row.unitPriceMad);
      if (
        !designation ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPriceMad) ||
        unitPriceMad < 0
      ) {
        throw new Error('ligne invalide');
      }
      const unit = String(row.unit ?? '').trim();
      return {
        designation,
        quantity,
        unit: unit || undefined,
        unitPriceMad,
        orderIndex: index,
      };
    });
    return lines;
  } catch {
    return null;
  }
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; code?: string }>;
}) {
  const {
    status: statusFilter,
    error: actionError,
    code: actionCode,
  } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const validStatus = INVOICE_STATUS_OPTIONS.some(
    (option) => option.value === statusFilter,
  )
    ? (statusFilter as InvoiceStatus)
    : undefined;
  const query = validStatus ? `?status=${validStatus}` : '';
  const [clients, invoices] = await Promise.all([
    apiGet<ClientRecord[]>('/sales/clients'),
    apiGet<InvoiceRecord[]>(`/sales/invoices${query}`),
  ]);
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const totalTtc = invoices.reduce((sum, invoice) => sum + invoice.totalTtcMad, 0);
  const outstandingTtc = invoices
    .filter((invoice) => invoice.status !== 'payee' && invoice.status !== 'annulee')
    .reduce((sum, invoice) => sum + invoice.totalTtcMad, 0);

  async function createInvoice(formData: FormData) {
    'use server';
    const clientId = String(formData.get('clientId') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const invoiceDate = String(formData.get('invoiceDate') ?? '');
    const tvaPct = Number(formData.get('tvaPct'));
    const lines = parsePricedLines(String(formData.get('lines') ?? ''));
    if (
      !clientId ||
      reference.length < 2 ||
      !invoiceDate ||
      !Number.isFinite(tvaPct) ||
      tvaPct < 0 ||
      tvaPct > 100 ||
      !lines
    ) {
      redirect('/sales/invoices?error=createInvoice&code=invalid');
    }
    try {
      const dueDate = String(formData.get('dueDate') ?? '');
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost('/sales/invoices', {
        clientId,
        reference,
        invoiceDate,
        dueDate: dueDate || undefined,
        tvaPct,
        notes: notes || undefined,
        lines,
      });
    } catch (error) {
      failToInvoices('createInvoice', error);
    }
    revalidatePath('/sales/invoices');
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Factures</h1>
          <p className="mt-1 text-sm text-muted">
            Facturation commerciale — HT / TVA / TTC, suivi des règlements et
            impression
          </p>
        </div>
        <nav className="flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/sales/invoices"
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              !validStatus
                ? 'bg-cyan-soft/60 text-ink'
                : 'border border-line-2 text-muted hover:bg-sand'
            }`}
          >
            Toutes
          </Link>
          {INVOICE_STATUS_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={`/sales/invoices?status=${option.value}`}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                validStatus === option.value
                  ? 'bg-cyan-soft/60 text-ink'
                  : 'border border-line-2 text-muted hover:bg-sand'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Factures
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {invoices.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Total TTC
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(totalTtc)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            En attente de règlement
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums text-cyan">
            {fmtMad(outstandingTtc)}
          </p>
        </div>
      </div>

      <section className="mb-8 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Factures ({invoices.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">HT</th>
              <th className="px-4 py-3 text-right">TTC</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices.map((invoice) => {
              const badge = INVOICE_STATUS_BADGES[invoice.status];
              return (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-mono text-xs font-bold">
                    {invoice.reference}
                  </td>
                  <td className="px-4 py-3">
                    {clientName.get(invoice.clientId) ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(invoice.invoiceDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                    {fmtMad(invoice.totalHtMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(invoice.totalTtcMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/invoices/${invoice.id}`}
                      className="text-xs font-medium text-cyan hover:underline"
                    >
                      Ouvrir →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoices.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune facture — créez-en une ci-dessous.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Nouvelle facture
        </h2>
        {clients.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            Aucun client enregistré — ajoutez d’abord un client dans la section
            Clients.
          </p>
        ) : (
          <form action={createInvoice} className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <label className="min-w-56 flex-1 text-sm">
                <span className="mb-1 block text-xs text-muted">Client</span>
                <select
                  name="clientId"
                  required
                  className="w-full rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                >
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.city ? ` — ${client.city}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Référence</span>
                <input
                  type="text"
                  name="reference"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="FAC-2026-001"
                  className="w-44 rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">
                  Date de facture
                </span>
                <input
                  type="date"
                  name="invoiceDate"
                  required
                  className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">
                  Échéance (optionnel)
                </span>
                <input
                  type="date"
                  name="dueDate"
                  className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
            </div>

            <LineEditor mode="priced" defaultTvaPct={20} />

            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">
                Notes (optionnel)
              </span>
              <input
                type="text"
                name="notes"
                maxLength={2000}
                className="w-full rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>

            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Enregistrer la facture
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
