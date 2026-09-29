'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refreshes the server-rendered mirror while the BDC screen stays open. */
export default function BdcAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return (
    <p className="mt-3 text-xs text-faint" aria-live="polite">
      Mise à jour automatique activée — dernières publications vérifiées régulièrement.
    </p>
  );
}
