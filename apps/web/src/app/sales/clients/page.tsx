import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import {
  CLIENT_STATUS_BADGES,
  fmtDate,
  type ClientRecord,
} from '@/lib/sales';

// next/navigation's redirect() throws a control-flow signal (NEXT_REDIRECT) that
// must NOT be swallowed by the action's catch — re-throw it untouched.
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Turn an action failure into user-visible feedback: log the real cause
// server-side, then redirect back with a stable error code the page renders as
// a banner. The HTTP status (when the cause is an AtlasApiError) distinguishes a
// 400 (validation) from a 5xx (server). Mirrors /stock.
function failToClients(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[sales/clients] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/sales/clients?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createClient:invalid':
    'Client refusé : le nom doit comporter au moins 2 caractères et l’email être valide.',
  'createClient:failed': 'Échec de l’enregistrement du client. Réessayez.',
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

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const clients = await apiGet<ClientRecord[]>('/sales/clients');
  const activeCount = clients.filter((c) => c.status === 'actif').length;

  async function createClient(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) {
      redirect('/sales/clients?error=createClient&code=invalid');
    }
    try {
      const email = String(formData.get('email') ?? '').trim();
      await apiPost('/sales/clients', {
        name,
        ice: String(formData.get('ice') ?? '').trim() || undefined,
        contactName:
          String(formData.get('contactName') ?? '').trim() || undefined,
        phone: String(formData.get('phone') ?? '').trim() || undefined,
        email: email || undefined,
        address: String(formData.get('address') ?? '').trim() || undefined,
        city: String(formData.get('city') ?? '').trim() || undefined,
        notes: String(formData.get('notes') ?? '').trim() || undefined,
      });
    } catch (error) {
      failToClients('createClient', error);
    }
    revalidatePath('/sales/clients');
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted">
            Référentiel commercial — clients privés des devis, bons de livraison
            et factures
          </p>
        </div>
        <Link
          href="/sales/quotes"
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-paper-2"
        >
          Devis →
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Clients
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {clients.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Actifs
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {activeCount}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Inactifs
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {clients.length - activeCount}
          </p>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Répertoire ({clients.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">ICE</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Ville</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Créé le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clients.map((client) => {
              const badge = CLIENT_STATUS_BADGES[client.status];
              return (
                <tr key={client.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      href={`/sales/clients/${client.id}`}
                      className="hover:text-cyan"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {client.ice ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {client.contactName ?? '—'}
                    {client.phone && (
                      <span className="block text-xs text-faint">
                        {client.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{client.city ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-faint">
                    {fmtDate(client.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {clients.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun client — enregistrez le premier ci-dessous.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Nouveau client
        </h2>
        <form action={createClient} className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Nom / Raison sociale</span>
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">ICE (optionnel)</span>
            <input
              type="text"
              name="ice"
              maxLength={20}
              className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Contact (optionnel)
            </span>
            <input
              type="text"
              name="contactName"
              maxLength={200}
              className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Téléphone (optionnel)
            </span>
            <input
              type="text"
              name="phone"
              maxLength={30}
              className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Email (optionnel)</span>
            <input
              type="email"
              name="email"
              maxLength={200}
              className="w-48 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Ville (optionnel)</span>
            <input
              type="text"
              name="city"
              maxLength={120}
              className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">
              Adresse (optionnel)
            </span>
            <input
              type="text"
              name="address"
              maxLength={500}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Notes (optionnel)</span>
            <input
              type="text"
              name="notes"
              maxLength={2000}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </form>
      </section>
    </div>
  );
}
