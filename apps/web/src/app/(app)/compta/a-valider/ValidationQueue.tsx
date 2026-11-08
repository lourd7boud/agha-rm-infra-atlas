'use client';

import { useActionState, useEffect, useState } from 'react';
import { fmtDate, fmtMad, type Ecriture, type SalesAccountingEvent } from '@/lib/compta';
import { validateSelectedEntries, retrySalesReconciliation, type ComptaActionState } from '../actions';

export function toggleSelectedId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

const INITIAL_STATE: ComptaActionState = { status: 'idle' };

export function ValidationQueue({
  entries, events, canApprove,
}: {
  entries: Ecriture[];
  events: SalesAccountingEvent[];
  canApprove: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionRecords, setSelectionRecords] = useState<Ecriture[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState(validateSelectedEntries, INITIAL_STATE);
  const [retryState, retryAction, retrying] = useActionState(retrySalesReconciliation, INITIAL_STATE);
  const chosen = selectionRecords.filter((entry) => selected.includes(entry.id));
  useEffect(() => {
    if (state.status === 'success') {
      setSelected([]);
      setSelectionRecords([]);
      setConfirmed(false);
    }
  }, [state]);
  return (
    <div className="space-y-6">
      {!canApprove && <p className="text-sm text-muted">Lecture seule — validation réservée à la direction et au comptable.</p>}
      <form action={action} className="rounded-xl border border-line bg-paper-2 p-5">
        <h2 className="mb-4 font-bold">Écritures brouillon</h2>
        <table className="w-full text-left text-sm">
          <thead><tr><th>Choisir</th><th>Date / origine</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line">
                <td className="py-3">
                  <input type="checkbox" aria-label={`Sélectionner ${entry.libelle}`}
                    value={entry.id}
                    checked={selected.includes(entry.id)} disabled={!canApprove || pending}
                    onChange={() => {
                      setSelected(toggleSelectedId(selected, entry.id));
                      setSelectionRecords((previous) => [
                        ...previous.filter((record) => record.id !== entry.id), entry,
                      ]);
                      setConfirmed(false);
                    }}
                  />
                </td>
                <td>{fmtDate(entry.dateEcriture)} · {entry.source}</td>
                <td><a href={`/compta/ecritures?ecriture=${entry.id}`} className="text-cyan">{entry.libelle}</a></td>
                <td className="font-mono">{fmtMad(entry.totalDebit)}</td>
                <td className="font-mono">{fmtMad(entry.totalCredit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="py-4 text-sm text-muted">Aucune écriture brouillon sur cette page.</p>}
        <input type="hidden" name="selectedIds" value={JSON.stringify(selected)} />
        <p className="my-4 text-sm" aria-live="polite">
          {selected.length} écriture(s) choisie(s) · Débit {fmtMad(chosen.reduce((sum, entry) => sum + entry.totalDebit, 0))}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} disabled={!canApprove || !selected.length}
            onChange={(event) => setConfirmed(event.target.checked)} />
          Confirmer la sélection après relecture
        </label>
        <button disabled={!canApprove || !selected.length || !confirmed || pending}
          className="mt-4 rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40">
          {pending ? 'Validation…' : 'Valider les écritures choisies'}
        </button>
        <p aria-live="polite" className="mt-3 text-sm">
          {state.status === 'error' ? state.message : state.status === 'success' ? 'Sélection validée et auditée.' : ''}
        </p>
      </form>
      <section className="rounded-xl border border-line bg-paper-2 p-5">
        <h2 className="font-bold">Réconciliation des ventes</h2>
        <p className="my-3 text-sm text-muted">La relance crée des brouillons. Leur validation reste une action distincte.</p>
        {events.map((event) => (
          <div key={event.id} className="my-3 rounded-lg border border-line p-3 text-sm">
            <p>{event.eventType} · {fmtDate(event.occurredAt)} · {event.status}</p>
            {event.lastErrorMessage && <p className="mt-1 text-clay">{event.lastErrorMessage}</p>}
            {event.status !== 'projected' && canApprove && (
              <form action={retryAction} className="mt-2">
                <input type="hidden" name="ids" value={event.id} />
                <button disabled={retrying} className="text-cyan">Relancer cet événement</button>
              </form>
            )}
          </div>
        ))}
        {!events.length && <p className="text-sm text-muted">Aucun événement en attente.</p>}
        <p aria-live="polite" className="text-sm">{retryState.message ?? (retryState.status === 'success' ? 'Relance terminée. Consultez le nouvel état.' : '')}</p>
      </section>
    </div>
  );
}
