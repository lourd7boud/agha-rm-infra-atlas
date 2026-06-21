import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { LineEditor } from '@/components/sales/LineEditor';
import {
  DELIVERY_STATUS_BADGES,
  DELIVERY_STATUS_OPTIONS,
  fmtDate,
  type ClientRecord,
  type DeliveryNoteRecord,
  type DeliveryNoteStatus,
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

function failToDeliveryNotes(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[delivery-notes] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : status === 404 ? 'invalid' : 'failed';
  redirect(`/sales/delivery-notes?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createDeliveryNote:invalid':
    'Bon refusé : un client, une référence, une date et au moins une ligne sont requis.',
  'createDeliveryNote:failed':
    'Échec de l’enregistrement du bon de livraison. Réessayez.',
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

interface DeliveryLineInput {
  designation: string;
  quantity: number;
  unit?: string;
  orderIndex: number;
}

function parseLines(raw: string): DeliveryLineInput[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const lines = parsed.map((item, index) => {
      const row = item as Record<string, unknown>;
      const designation = String(row.designation ?? '').trim();
      const quantity = Number(row.quantity);
      if (!designation || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('ligne invalide');
      }
      const unit = String(row.unit ?? '').trim();
      return {
        designation,
        quantity,
        unit: unit || undefined,
        orderIndex: index,
      };
    });
    return lines;
  } catch {
    return null;
  }
}

export default async function DeliveryNotesPage({
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
  const validStatus = DELIVERY_STATUS_OPTIONS.some(
    (option) => option.value === statusFilter,
  )
    ? (statusFilter as DeliveryNoteStatus)
    : undefined;
  const query = validStatus ? `?status=${validStatus}` : '';
  const [clients, notes] = await Promise.all([
    apiGet<ClientRecord[]>('/sales/clients'),
    apiGet<DeliveryNoteRecord[]>(`/sales/delivery-notes${query}`),
  ]);
  const clientName = new Map(clients.map((client) => [client.id, client.name]));

  async function createDeliveryNote(formData: FormData) {
    'use server';
    const clientId = String(formData.get('clientId') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const deliveryDate = String(formData.get('deliveryDate') ?? '');
    const lines = parseLines(String(formData.get('lines') ?? ''));
    if (!clientId || reference.length < 2 || !deliveryDate || !lines) {
      redirect('/sales/delivery-notes?error=createDeliveryNote&code=invalid');
    }
    try {
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost('/sales/delivery-notes', {
        clientId,
        reference,
        deliveryDate,
        notes: notes || undefined,
        lines,
      });
    } catch (error) {
      failToDeliveryNotes('createDeliveryNote', error);
    }
    revalidatePath('/sales/delivery-notes');
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Bons de livraison</h1>
          <p className="mt-1 text-sm text-muted">
            Sorties de marchandises vers les clients commerciaux — suivi et
            impression
          </p>
        </div>
        <nav className="flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/sales/delivery-notes"
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              !validStatus
                ? 'bg-cyan-soft/60 text-ink'
                : 'border border-line-2 text-muted hover:bg-sand'
            }`}
          >
            Tous
          </Link>
          {DELIVERY_STATUS_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={`/sales/delivery-notes?status=${option.value}`}
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

      <section className="mb-8 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Bons de livraison ({notes.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Lignes</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {notes.map((note) => {
              const badge = DELIVERY_STATUS_BADGES[note.status];
              return (
                <tr key={note.id}>
                  <td className="px-4 py-3 font-mono text-xs font-bold">
                    {note.reference}
                  </td>
                  <td className="px-4 py-3">
                    {clientName.get(note.clientId) ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(note.deliveryDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {note.lines.length}
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
                      href={`/sales/delivery-notes/${note.id}`}
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
        {notes.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun bon de livraison — créez-en un ci-dessous.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Nouveau bon de livraison
        </h2>
        {clients.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            Aucun client enregistré — ajoutez d’abord un client dans la section
            Clients.
          </p>
        ) : (
          <form action={createDeliveryNote} className="space-y-5">
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
                  placeholder="BL-2026-001"
                  className="w-44 rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">
                  Date de livraison
                </span>
                <input
                  type="date"
                  name="deliveryDate"
                  required
                  className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
            </div>

            <LineEditor mode="delivery" />

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
              Enregistrer le bon de livraison
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
