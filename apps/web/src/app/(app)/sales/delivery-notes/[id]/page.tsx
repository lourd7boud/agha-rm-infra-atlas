import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, AtlasApiError } from '@/lib/api';
import {
  DELIVERY_STATUS_BADGES,
  DELIVERY_STATUS_OPTIONS,
  fmtDate,
  fmtQtyUnit,
  type ClientRecord,
  type DeliveryNoteRecord,
  type DeliveryNoteStatus,
} from '@/lib/sales';
import { isRedirectError } from '@/lib/next-redirect';

function failToNote(id: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[sales/delivery-notes] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/sales/delivery-notes/${id}?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'setStatus:invalid': 'Statut refusé : valeur inattendue.',
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

export default async function DeliveryNoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const note = await apiGet<DeliveryNoteRecord>(`/sales/delivery-notes/${id}`);
  const client = await apiGet<ClientRecord>(`/sales/clients/${note.clientId}`);
  const badge = DELIVERY_STATUS_BADGES[note.status];

  async function setStatus(formData: FormData) {
    'use server';
    const status = String(formData.get('status') ?? '') as DeliveryNoteStatus;
    if (!DELIVERY_STATUS_OPTIONS.some((option) => option.value === status)) {
      redirect(`/sales/delivery-notes/${id}?error=setStatus&code=invalid`);
    }
    try {
      await apiPatch(`/sales/delivery-notes/${id}/status`, { status });
    } catch (error) {
      failToNote(id, 'setStatus', error);
    }
    revalidatePath(`/sales/delivery-notes/${id}`);
    revalidatePath('/sales/delivery-notes');
  }

  return (
    <div>
      <Link
        href="/sales/delivery-notes"
        className="text-sm text-muted hover:text-ink"
      >
        ← Bons de livraison
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{note.reference}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
        <Link
          href={`/sales/delivery-notes/${note.id}/print`}
          className="ml-auto rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan"
        >
          Imprimer / PDF
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted">
        {client.name} — livré le {fmtDate(note.deliveryDate)}
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <form
        action={setStatus}
        className="mb-8 flex flex-wrap items-end gap-2"
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Statut</span>
          <select
            name="status"
            defaultValue={note.status}
            className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
          >
            {DELIVERY_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border border-line-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand">
          Mettre à jour
        </button>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Client
          </p>
          <p className="mt-2 font-semibold">{client.name}</p>
          {client.city && <p className="text-sm text-muted">{client.city}</p>}
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Date de livraison
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtDate(note.deliveryDate)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Articles
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {note.lines.length}
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Articles livrés ({note.lines.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3 text-right">Quantité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {note.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3 font-semibold">{line.designation}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtQtyUnit(line.quantity, line.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {note.lines.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune ligne sur ce bon de livraison.
          </p>
        )}
      </section>

      {note.notes && (
        <section className="mt-6 rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">
            Notes
          </h2>
          <p className="text-sm text-ink-2">{note.notes}</p>
        </section>
      )}
    </div>
  );
}
