'use client';

import Link from 'next/link';

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
      <p className="mt-2 text-sm text-slate-600">
        {error.message.includes('409')
          ? 'Transition non autorisée depuis l’état actuel du dossier.'
          : error.message.includes('503')
            ? 'Service IA momentanément indisponible — réessayer dans quelques instants.'
            : 'Erreur de communication avec ATLAS Core.'}
      </p>
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
