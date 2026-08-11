import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { Pager } from '@/components/ui/Pager';
import {
  fmtDate,
  fmtMad,
  QUOTE_STATUS_BADGES,
  QUOTE_STATUS_OPTIONS,
  type ClientRecord,
  type Paged,
  type QuoteListItem,
  type QuoteStatus,
  type QuoteSummary,
} from '@/lib/sales';
import { isRedirectError } from '@/lib/next-redirect';
import { QuoteLinesEditor } from './QuoteLinesEditor';

const PAGE_SIZE = 25;

interface CreateLineInput {
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  orderIndex?: number;
}

function failToQuotes(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[sales/quotes] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : status === 404 ? 'notfound' : 'failed';
  redirect(`/sales/quotes?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createQuote:invalid':
    'Devis refusé : client, référence (≥2 car.) et au moins une ligne complète requis.',
  'createQuote:notfound': 'Devis refusé : client introuvable.',
  'createQuote:failed': 'Échec de l’enregistrement du devis. Réessayez.',
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

/** Narrow the raw ?status query into a QuoteStatus, ignoring unknown values. */
function parseStatus(value: string | undefined): QuoteStatus | undefined {
  return QUOTE_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as QuoteStatus)
    : undefined;
}

/** Parse the editor's hidden JSON `lines` field into typed create inputs. */
function parseLines(raw: string): CreateLineInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (line): line is Record<string, unknown> =>
        typeof line === 'object' && line !== null,
    )
    .map((line, index) => ({
      designation: String(line.designation ?? '').trim(),
      quantity: Number(line.quantity),
      unit: line.unit ? String(line.unit) : undefined,
      unitPriceMad: Number(line.unitPriceMad),
      orderIndex: index,
    }))
    .filter(
      (line) =>
        line.designation.length > 0 &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isFinite(line.unitPriceMad) &&
        line.unitPriceMad >= 0,
    );
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    code?: string;
    clientId?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const errorMessage = actionErrorMessage(sp.error, sp.code);
  const status = parseStatus(sp.status);
  const clientId = sp.clientId || undefined;
  const page = Math.max(0, Math.floor(Number(sp.page)) || 0);

  // Filter params shared by the list page, the summary and the pager hrefs.
  const filterQuery = new URLSearchParams();
  if (clientId) filterQuery.set('clientId', clientId);
  if (status) filterQuery.set('status', status);
  const filterString = filterQuery.toString();
  const filterPrefix = filterString ? `${filterString}&` : '';

  // One bounded DB page for the table + a DB-side summary for the count/total
  // (correct over ALL matching quotes, not just this page) + clients for names.
  const [quotePage, summary, clientPage] = await Promise.all([
    apiGet<Paged<QuoteListItem>>(
      `/sales/quotes?${filterPrefix}page=${page}&limit=${PAGE_SIZE}`,
    ),
    apiGet<QuoteSummary>(
      `/sales/quotes/summary${filterString ? `?${filterString}` : ''}`,
    ),
    apiGet<Paged<ClientRecord>>('/sales/clients?limit=100'),
  ]);
  const quotes = quotePage.items;
  const clients = clientPage.items;
  const clientById = new Map(clients.map((client) => [client.id, client]));

  async function createQuote(formData: FormData) {
    'use server';
    const clientIdValue = String(formData.get('clientId') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const quoteDate = String(formData.get('quoteDate') ?? '');
    const tvaPct = Number(formData.get('tvaPct'));
    const lines = parseLines(String(formData.get('lines') ?? '[]'));
    if (
      !clientIdValue ||
      reference.length < 2 ||
      !quoteDate ||
      !Number.isFinite(tvaPct) ||
      tvaPct < 0 ||
      tvaPct > 100 ||
      lines.length === 0
    ) {
      redirect('/sales/quotes?error=createQuote&code=invalid');
    }
    try {
      const objet = String(formData.get('objet') ?? '').trim();
      const validUntil = String(formData.get('validUntil') ?? '');
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost('/sales/quotes', {
        clientId: clientIdValue,
        reference,
        objet: objet || undefined,
        quoteDate,
        validUntil: validUntil || undefined,
        tvaPct,
        notes: notes || undefined,
        lines,
      });
    } catch (error) {
      failToQuotes('createQuote', error);
    }
    revalidatePath('/sales/quotes');
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Devis</h1>
          <p className="mt-1 text-sm text-muted">
            Offres de prix commerciales — chiffrage HT / TVA / TTC et suivi de
            statut
          </p>
        </div>
        <Link
          href="/sales/clients"
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-paper-2"
        >
          ← Clients
        </Link>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Devis ({summary.count}) · total TTC{' '}
            <span className="font-mono tabular-nums text-ink-2">
              {fmtMad(summary.totalTtcMad)}
            </span>
          </h2>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Client</span>
              <select
                name="clientId"
                defaultValue={clientId ?? ''}
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">Tous</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Statut</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">Tous</option>
                {QUOTE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md border border-line-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand">
              Filtrer
            </button>
            {(clientId || status) && (
              <Link
                href="/sales/quotes"
                className="rounded-md px-3 py-2 text-sm text-faint transition hover:text-ink"
              >
                Réinitialiser
              </Link>
            )}
          </form>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Objet</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">HT</th>
              <th className="px-4 py-3 text-right">TTC</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {quotes.map((quote) => {
              const badge = QUOTE_STATUS_BADGES[quote.status];
              return (
                <tr key={quote.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    <Link
                      href={`/sales/quotes/${quote.id}`}
                      className="hover:text-cyan"
                    >
                      {quote.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {clientById.get(quote.clientId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted">{quote.objet ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(quote.quoteDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(quote.totalHtMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(quote.totalTtcMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {quotes.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            {summary.count === 0
              ? `Aucun devis${clientId || status ? ' pour ce filtre' : ''} — créez-en un ci-dessous.`
              : 'Aucun devis sur cette page.'}
          </p>
        )}
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={quotePage.total}
          hrefForPage={(p) => `/sales/quotes?${filterPrefix}page=${p}`}
        />
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
          Nouveau devis
        </h2>
        <p className="mb-4 text-xs text-faint">
          Le total HT / TVA / TTC est recalculé côté serveur à l’enregistrement.
        </p>
        {clients.length > 0 ? (
          <form action={createQuote} className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-sm">
                <span className="mb-1 block text-xs text-muted">Client</span>
                <select
                  name="clientId"
                  required
                  defaultValue={clientId ?? ''}
                  className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                >
                  <option value="" disabled>
                    Sélectionner…
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
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
                  placeholder="DV-2026-001"
                  className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Date</span>
                <input
                  type="date"
                  name="quoteDate"
                  required
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">
                  Valide jusqu’au (optionnel)
                </span>
                <input
                  type="date"
                  name="validUntil"
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">
                Objet (optionnel)
              </span>
              <input
                type="text"
                name="objet"
                maxLength={500}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>

            <QuoteLinesEditor />

            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">
                Notes (optionnel)
              </span>
              <input
                type="text"
                name="notes"
                maxLength={2000}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>

            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Enregistrer le devis
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            Enregistrez au moins un{' '}
            <Link href="/sales/clients" className="text-cyan hover:underline">
              client
            </Link>{' '}
            avant de créer un devis.
          </p>
        )}
      </section>
    </div>
  );
}
