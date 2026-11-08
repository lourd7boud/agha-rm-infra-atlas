'use client';

import { useActionState } from 'react';
import type { ComptaProfil } from '@/lib/compta';
import { updateFaitGenerateurTva, type ComptaActionState } from '../actions';

export function TvaConfiguration({ value, canConfigure }: {
  value: ComptaProfil['faitGenerateurTva']; canConfigure: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateFaitGenerateurTva, { status: 'idle' } as ComptaActionState,
  );
  return (
    <form action={action} className="mb-6 rounded-xl border border-line bg-paper-2 p-5">
      <h2 className="font-bold">Fait générateur TVA</h2>
      {value === 'non_configure' && <p role="alert" className="my-3 text-sm text-clay">TVA non configurée : la projection comptable des ventes reste bloquée.</p>}
      <label className="mt-3 block text-sm">
        Exigibilité de la TVA
        <select name="faitGenerateurTva" defaultValue={value} disabled={!canConfigure || pending}
          className="ml-3 rounded-md border border-line-2 bg-paper px-3 py-2">
          <option value="non_configure">Non configuré</option>
          <option value="encaissement">Encaissement</option>
          <option value="debits">Débits</option>
        </select>
      </label>
      {canConfigure && <button disabled={pending} className="mt-3 rounded-md border border-line-2 px-4 py-2 text-sm">Enregistrer le fait générateur</button>}
      <p aria-live="polite" className="mt-2 text-sm">{state.message ?? (state.status === 'success' ? 'Configuration enregistrée.' : '')}</p>
    </form>
  );
}
