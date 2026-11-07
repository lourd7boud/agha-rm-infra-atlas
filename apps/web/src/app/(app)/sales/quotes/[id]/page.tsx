import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  QUOTE_STATUS_BADGES,
  tvaMad,
  type ClientRecord,
  type QuoteRecord,
} from '@/lib/sales';
import { isRedirectError } from '@/lib/next-redirect';

function failToQuote(id: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[sales/quotes] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/sales/quotes/${id}?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'issue:invalid': 'Émission refusée : vérifiez les données du devis.',
  'issue:failed': 'Échec de l’émission du devis. Réessayez.',
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

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const quote = await apiGet<QuoteRecord>(`/sales/quotes/${id}`);
  const client = await apiGet<ClientRecord>(`/sales/clients/${quote.clientId}`);
  const badge = QUOTE_STATUS_BADGES[quote.status];

  async function issue() {
    'use server';
    try {
      await apiPost(`/sales/quotes/${id}/issue`, {});
    } catch (error) {
      failToQuote(id, 'issue', error);
    }
    revalidatePath(`/sales/quotes/${id}`);
    revalidatePath('/sales/quotes');
  }

  return (
    <div>
      <Link href="/sales/quotes" className="text-sm text-muted hover:text-ink">
        ← Devis
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">
          {quote.reference ?? 'Brouillon de devis'}
        </h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        <Link
          href={`/sales/clients/${client.id}`}
          className="font-medium text-ink-2 hover:text-cyan"
        >
          {client.name}
        </Link>
        {quote.objet ? ` — ${quote.objet}` : ''} · établi le{' '}
        {fmtDate(quote.quoteDate)}
        {quote.validUntil ? ` · valide jusqu’au ${fmtDate(quote.validUntil)}` : ''}
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/sales/quotes/${id}/print?format=detaille`}
          target="_blank"
          className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan"
        >
          Imprimer (détaillé)
        </Link>
        <Link
          href={`/sales/quotes/${id}/print?format=simple`}
          target="_blank"
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-paper-2"
        >
          Imprimer (simple)
        </Link>
        {quote.status === 'brouillon' && (
          <form action={issue} className="ml-auto">
            <button className="rounded-md border border-cyan px-4 py-2 text-sm font-semibold text-cyan transition hover:bg-cyan-soft">
              Émettre le devis
            </button>
          </form>
        )}
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Lignes ({quote.lines.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 w-10">#</th>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3 text-right">P.U.</th>
              <th className="px-4 py-3 text-right">Total HT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {quote.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="px-4 py-3 font-mono text-xs text-faint">
                  {index + 1}
                </td>
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
          <tfoot className="border-t border-line bg-sand/40">
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-sm text-muted">
                Total HT
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">
                {fmtMad(quote.totalHtMad)}
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-sm text-muted">
                TVA ({quote.tvaPct}%)
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">
                {fmtMad(tvaMad(quote))}
              </td>
            </tr>
            <tr>
              <td
                colSpan={4}
                className="px-4 py-3 text-right text-sm font-semibold"
              >
                Total TTC
              </td>
              <td className="px-4 py-3 text-right font-mono text-base font-bold tabular-nums">
                {fmtMad(quote.totalTtcMad)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {quote.notes && (
        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">
            Notes
          </h2>
          <p className="text-sm text-ink-2">{quote.notes}</p>
        </section>
      )}
    </div>
  );
}
