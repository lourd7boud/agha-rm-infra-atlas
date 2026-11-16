'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { TerrainAttachement } from '@/lib/btp-shared';
import { integrateTerrainBatch } from './terrain-attachement-actions';

export interface TerrainBatchPeriod {
  id: string;
  numero: number;
  start: string;
  end: string;
}

function dateLabel(date: string) {
  return date.slice(0, 10).split('-').reverse().join('/');
}

export function TerrainAttachementBatch({ projectId, periods, attachements }: {
  projectId: string;
  periods: TerrainBatchPeriod[];
  attachements: (TerrainAttachement & { prixDateEffet?: string })[];
}) {
  const [periodId, setPeriodId] = useState(periods.length === 1 ? periods[0]!.id : '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, action, pending] = useActionState(integrateTerrainBatch.bind(null, projectId), { status: 'idle' });
  const period = periods.find((item) => item.id === periodId);
  const eligible = period ? attachements.filter((item) => {
    const date = item.date.slice(0, 10);
    const validPrice = !item.prixDateEffet || (date >= item.prixDateEffet &&
      (item.isExecutionDate || period.start >= item.prixDateEffet));
    return date >= period.start && date <= period.end && validPrice;
  }) : [];
  const count = eligible.filter((item) => selected.has(item.id)).length;

  return (
    <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
      <h3 className="font-semibold text-ink">Intégrer les attachements au métré</h3>
      <form action={action} className="mt-3 space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          {periods.length ? (
            <label className="block max-w-sm text-sm text-muted">
              Métré en cours
              <select name="periodeId" value={period?.id ?? ''} required
                onChange={(event) => { setPeriodId(event.target.value); setSelected(new Set()); }}
                className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink">
                <option value="">Choisir un métré</option>
                {periods.map((item) => <option key={item.id} value={item.id}>
                  N°{item.numero} · {dateLabel(item.start)} au {dateLabel(item.end)}
                </option>)}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted">
              Choisissez un métré en cours avec un début de travaux et des dates d’arrêté successives dans l’ordre.
              {' '}<Link href={`/projects/${projectId}?tab=metres`} className="font-semibold text-cyan underline">Voir les métrés</Link>
            </p>
          )}

          {period && (eligible.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                <span>{count} sélectionné(s) sur {eligible.length}</span>
                <button type="button" onClick={() => setSelected(count ? new Set() : new Set(eligible.slice(0, 100).map((item) => item.id)))}
                  className="font-semibold text-cyan underline">
                  {count ? 'Désélectionner' : eligible.length > 100 ? 'Sélectionner les 100 premiers' : 'Tout sélectionner'}
                </button>
              </div>
              <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {eligible.map((item) => <li key={item.id}>
                  <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <input type="checkbox" name="attachementId" value={item.id}
                      checked={selected.has(item.id)} disabled={count >= 100 && !selected.has(item.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        });
                      }} className="accent-cyan" />
                    <span className="font-mono text-xs text-muted">{dateLabel(item.date)}</span>
                    <span className="flex-1">{item.numeroPrix ? `N°${item.numeroPrix} · ` : ''}{item.designation}
                      {item.note && <span className="block text-xs text-muted">{item.note}</span>}
                    </span>
                    <span className="font-mono">{item.quantite} {item.unite}</span>
                  </label>
                </li>)}
              </ul>
              <button type="submit" disabled={count === 0} className="rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper disabled:opacity-45">
                {pending ? 'Intégration en cours…' : 'Intégrer la sélection'}
              </button>
            </>
          ) : <p className="text-sm text-muted">Aucun attachement à intégrer dans cette période.</p>)}
        </fieldset>
        {result.status === 'error' && <p role="alert" className="text-sm text-clay">{result.message}</p>}
        {result.status === 'success' && <p role="status" className="text-sm text-emerald">
          {result.count} attachement(s) intégré(s).{' '}
          <Link href={`/projects/${projectId}/metres/${result.periodeId}`} className="font-semibold underline">Ouvrir le métré</Link>
        </p>}
      </form>
    </section>
  );
}
