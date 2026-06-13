'use client';

import Link from 'next/link';

const STATUS_MESSAGES: Record<string, string> = {
  '404': 'Dossier introuvable — il a peut-être été supprimé.',
  '409': 'Transition non autorisée depuis l’état actuel du dossier.',
  '503': 'Service IA momentanément indisponible — réessayer dans quelques instants.',
};

/**
 * Production redacts error.message; the upstream HTTP status travels in the
 * digest (`ATLAS_API_<status>`, set by AtlasApiError). Message sniffing stays
 * as a dev-mode fallback.
 */
function explain(error: Error & { digest?: string }): string {
  const status = error.digest?.startsWith('ATLAS_API_')
    ? error.digest.slice('ATLAS_API_'.length)
    : Object.keys(STATUS_MESSAGES).find((code) => error.message.includes(code));
  return (
    (status && STATUS_MESSAGES[status]) ?? 'Erreur de communication avec ATLAS Core.'
  );
}

/** Route-level boundary: gate actions and agent calls fail loudly but cleanly. */
export default function TenderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
      <h1 className="text-lg font-bold text-rose-800">
        L&apos;action n&apos;a pas abouti
      </h1>
      <p className="mt-2 text-sm text-slate-600">{explain(error)}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Réessayer
        </button>
        <Link
          href="/tenders"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
        >
          Mur des échéances
        </Link>
      </div>
    </div>
  );
}
