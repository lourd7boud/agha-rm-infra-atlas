'use client';

import { useState } from 'react';
import { DIAMETRES_DISPONIBLES } from '@/lib/btp-shared';
import { entryColumns, readMetreNumber, type NumericMeasureField } from '@/lib/metre-entry';

export function MetreSelectionBar({ unit, count, invalid, onFill, onDuplicate, onDelete, onClear }: {
  unit: string; count: number; invalid: boolean;
  onFill: (field: NumericMeasureField, value: number) => void;
  onDuplicate: () => void; onDelete: () => void; onClear: () => void;
}) {
  const columns = entryColumns(unit).filter((column) => column.field !== 'designation' && column.field !== 'ignore' && column.field !== 'unit');
  const [field, setField] = useState<NumericMeasureField>(columns[0].field as NumericMeasureField);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  return <div className="mb-3 space-y-3 rounded-xl border border-cyan/25 bg-cyan-soft/20 p-3">
    <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto text-xs text-cyan">{count} mesure(s) sélectionnée(s)</strong><button type="button" disabled={invalid} title={invalid ? 'Corrigez les nombres invalides avant de dupliquer.' : 'Dupliquer les mesures sélectionnées'} onClick={onDuplicate} className="rounded-md border border-line bg-paper-2 px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 disabled:opacity-40">Dupliquer la sélection</button><button type="button" onClick={onDelete} className="rounded-md border border-clay/25 px-2.5 py-1.5 text-[11px] font-semibold text-clay">Supprimer la sélection</button><button type="button" onClick={onClear} aria-label="Désélectionner les mesures" className="px-2 text-muted">✕</button></div>
    <div className="flex flex-wrap items-end gap-2"><label className="text-[10px] text-muted">Champ à modifier<select aria-label="Champ de remplissage groupé" value={field} onChange={(event) => { setField(event.target.value as NumericMeasureField); setError(''); }} className="mt-1 block rounded-lg border border-line bg-paper px-2.5 py-2 text-xs text-ink">{columns.map((column) => <option key={column.field} value={column.field}>{column.label}</option>)}</select></label><label className="text-[10px] text-muted">Nouvelle valeur<input aria-label="Valeur de remplissage groupé" inputMode="decimal" value={raw} onChange={(event) => { setRaw(event.target.value); setError(''); }} placeholder="Ex. : 0,25" className="mt-1 block w-28 rounded-lg border border-line bg-paper px-2.5 py-2 font-mono text-xs text-ink outline-none focus:border-cyan" /></label><button type="button" onClick={() => {
      const value = readMetreNumber(raw);
      if (value === undefined) return setError('Saisissez un nombre décimal valide.');
      if ((field === 'nombreElements' || field === 'nombreSemblables') && (!Number.isInteger(value) || value === 0)) return setError('Le nombre de répétitions doit être un entier non nul.');
      if (field === 'diametre' && !DIAMETRES_DISPONIBLES.includes(value)) return setError('Choisissez un diamètre du barème.');
      onFill(field, value); setError('');
    }} className="rounded-lg bg-cyan px-3 py-2 text-xs font-semibold text-paper">Appliquer à {count} mesure(s)</button><span className="pb-2 text-[10px] text-muted">Les autres mesures sont conservées.</span></div>
    {error && <p role="alert" className="text-xs text-clay">{error}</p>}
  </div>;
}
