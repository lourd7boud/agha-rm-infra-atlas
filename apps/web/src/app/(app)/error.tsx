'use client';

import Link from 'next/link';
import { openReauthWindow } from '@/lib/reauth-window';

/**
 * Global route backstop. ANY page segment that throws during render without its
 * own error.tsx lands here instead of Next.js's naked "Application error" digest
 * screen (which is what /stock showed before this existed). The upstream HTTP
 * status rides in `error.digest` as `ATLAS_API_<status>` (see lib/api.ts) so we
 * can say WHY it failed. This is a backstop only — data surfaces should still
 * degrade in-place (per-call `.catch`) rather than rely on this.
 */
const STATUS_MESSAGES: Record<string, string> = {
  '401': 'Session expirée — vos données saisies sont conservées. Reconnectez-vous pour les enregistrer.',
  '403': "Votre rôle n'a pas accès à cette section.",
  '404': 'Ressource introuvable.',
  '500': 'Erreur interne du serveur ATLAS — réessayez dans un instant.',
  '503': 'Service momentanément indisponible — réessayez dans quelques instants.',
};

function resolveStatus(error: Error & { digest?: string }): string | undefined {
  return error.digest?.startsWith('ATLAS_API_')
    ? error.digest.slice('ATLAS_API_'.length)
    : Object.keys(STATUS_MESSAGES).find((code) => error.message.includes(code));
}

function explain(error: Error & { digest?: string }): string {
  const status = resolveStatus(error);
  return (
    (status && STATUS_MESSAGES[status]) ??
    'Une erreur est survenue. Les données sont intactes — réessayez.'
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // An expired session is NOT a broken section: the page stays where it is, the
  // notice says the input is kept, and re-authentication happens in a POPUP so
  // this route is never unmounted (see lib/reauth-window.ts).
  const sessionExpired = resolveStatus(error) === '401';

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-clay-soft bg-clay-soft/20 p-8 text-center">
      <h1 className="text-lg font-bold text-clay">
        {sessionExpired ? 'Session à renouveler' : 'Section momentanément indisponible'}
      </h1>
      <p className="mt-2 text-sm text-muted">{explain(error)}</p>
      <div className="mt-6 flex justify-center gap-3">
        {sessionExpired && (
          <button
            type="button"
            onClick={openReauthWindow}
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-ink-2"
          >
            Se reconnecter
          </button>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-paper-2"
        >
          Command Center
        </Link>
      </div>
    </div>
  );
}
