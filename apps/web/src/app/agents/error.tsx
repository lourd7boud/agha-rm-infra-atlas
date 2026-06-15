'use client';

import Link from 'next/link';

const STATUS_MESSAGES: Record<string, string> = {
  '403': "Votre rôle n'a pas accès à la salle des agents.",
  '404': 'Ressource introuvable.',
  '503': 'Service momentanément indisponible — réessayer dans quelques instants.',
};

function explain(error: Error & { digest?: string }): string {
  const status = error.digest?.startsWith('ATLAS_API_')
    ? error.digest.slice('ATLAS_API_'.length)
    : Object.keys(STATUS_MESSAGES).find((code) => error.message.includes(code));
  return (
    (status && STATUS_MESSAGES[status]) ??
    'Erreur de communication avec ATLAS Core.'
  );
}

export default function AgentsRoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-clay-soft bg-clay-soft/20 p-8 text-center">
      <h1 className="text-lg font-bold text-clay">Salle des agents indisponible</h1>
      <p className="mt-2 text-sm text-muted">{explain(error)}</p>
      <div className="mt-6 flex justify-center gap-3">
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
