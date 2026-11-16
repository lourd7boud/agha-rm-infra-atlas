'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function InventoryUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="mx-auto max-w-xl px-4 py-16 text-center">
    <h1 className="text-xl font-semibold text-ink">Catalogue momentanément indisponible</h1>
    <p className="mt-2 text-sm text-muted">La lecture du catalogue a échoué. Consultez l’état du radar ci-dessus, puis réessayez.</p>
    <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending} className="mt-6 rounded-md bg-cyan px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50">{pending ? 'Chargement…' : 'Réessayer'}</button>
  </div>;
}
