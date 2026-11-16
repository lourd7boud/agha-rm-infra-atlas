'use client';

import { useCallback, useEffect, useState } from 'react';
import { moroccoTimeZone } from '@atlas/contracts';

interface RadarStatus {
  sourceMode: 'live' | 'fixture';
  state: 'unknown' | 'stale' | 'failed' | 'blocked' | 'closed' | 'ready' | 'partial' | 'running';
  lastSuccessAt: string | null;
  portalReopensAt: string | null;
  cooldownUntil: string | null;
  nextRunAt: string | null;
  run: { uniqueSeen: number | null; portalTotal: number | null; pagesFetched: number; inserted: number; errors: number; skippedRows: number; stopReason: string | null } | null;
}
const labels: Record<RadarStatus['state'], string> = {
  unknown: 'Première synchronisation attendue', stale: 'Données à actualiser', failed: 'Lecture du portail en échec',
  blocked: 'Portail temporairement inaccessible', closed: 'Portail fermé selon ses horaires',
  ready: 'Dernier passage complet', partial: 'Couverture partielle', running: 'Collecte en cours',
};
function date(value: string) {
  const instant = new Date(value);
  return instant.toLocaleString('fr-MA', {
    timeZone: moroccoTimeZone(instant), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function RadarHealth() {
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/watch', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(response.status === 401 ? 'Session expirée : reconnectez-vous.' : response.status === 403 ? 'Accès au radar non autorisé.' : 'État du radar indisponible.');
      const data: RadarStatus = await response.json();
      if (!signal?.aborted) { setStatus(data); setError(null); }
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'État du radar indisponible.');
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void load(abort.signal); }, 30_000);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [load]);
  const refresh = async () => {
    setPending(true); setNotice(null);
    try {
      const response = await fetch('/api/watch', { method: 'POST', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(response.status === 401 ? 'Session expirée : reconnectez-vous.' : 'Synchronisation non démarrée.');
      const result = await response.json();
      setNotice(result.portalReopensAt ? `Le portail rouvre le ${date(result.portalReopensAt)}.`
        : result.queued === false ? 'Le portail est en pause. La reprise automatique est programmée.'
          : 'Synchronisation demandée. Les nouvelles annonces apparaîtront automatiquement.');
      await load();
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Synchronisation non démarrée.'); }
    finally { setPending(false); }
  };
  const good = !error && status?.state === 'ready' && status.sourceMode === 'live';
  const run = status?.run;
  return <section aria-label="État du radar central" className="mb-5 rounded-xl border border-line bg-paper-2 px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${good ? 'bg-emerald' : status?.state === 'running' && !error ? 'bg-cyan' : 'bg-clay'}`} aria-hidden="true" />
          <span className="font-semibold text-ink">Radar central</span>
          <span className="text-muted" role="status">{error ?? (status ? labels[status.state] : 'Vérification de la source…')}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Source : {status?.sourceMode === 'fixture' ? 'données de démonstration' : 'portail des marchés publics'} · Dernière lecture réussie : {status?.lastSuccessAt ? date(status.lastSuccessAt) : 'non confirmée'}
        </p>
        {run && <p className="mt-1 text-xs text-muted">
          {run.uniqueSeen ?? 0} {run.portalTotal != null ? `/ ${run.portalTotal}` : ''} annonces lues lors du passage · {run.pagesFetched} page(s) · {run.inserted} nouvelle(s)
          {run.skippedRows > 0 ? ` · ${run.skippedRows} annonce(s) à vérifier` : ''}
          {run.errors > 0 ? ` · ${run.errors} erreur(s)` : ''}
        </p>}
        {status?.portalReopensAt && <p className="mt-1 text-xs text-faint">Réouverture du portail : {date(status.portalReopensAt)} (heure du Maroc)</p>}
        {!status?.portalReopensAt && (status?.cooldownUntil || status?.nextRunAt) && <p className="mt-1 text-xs text-faint">Reprise prévue : {date(status.cooldownUntil ?? status.nextRunAt!)}</p>}
      </div>
      <button type="button" onClick={refresh} disabled={pending || status?.state === 'running' || status?.state === 'closed'} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-sand disabled:opacity-50">
        {pending ? 'Demande…' : status?.state === 'running' ? 'Collecte en cours…'
          : status?.state === 'closed' ? 'Portail fermé' : 'Synchroniser le portail'}
      </button>
    </div>
    {notice && <p role="status" className="mt-2 text-xs text-muted">{notice}</p>}
  </section>;
}
