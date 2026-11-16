'use client';

import { useRef, useState } from 'react';

export function CodeValueFields({ codeName, valueName, initialValues = {}, onSource, required = true, valueLabel = 'Valeur', min = '0.000001' }: {
  codeName: string;
  valueName: string;
  initialValues?: Record<string, number>;
  onSource?: (code: string) => void;
  required?: boolean;
  valueLabel?: string;
  min?: string;
}) {
  const initial = Object.entries(initialValues);
  const [rows, setRows] = useState(() => initial.length
    ? initial.map(([code, value], key) => ({ key, code, value: String(value), originalCode: code }))
    : [{ key: 0, code: '', value: '', originalCode: '' }]);
  const nextKey = useRef(rows.length);
  const input = 'mt-1 block w-full min-w-0 rounded-lg border border-line bg-paper px-2 py-2 text-sm text-ink';

  function change(key: number, field: 'code' | 'value', value: string) {
    setRows((previous) => previous.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }

  return <div className="min-w-0 space-y-2">
    {rows.map((row) => <div key={row.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
      <label className="min-w-0 text-xs text-muted">Code
        <input name={codeName} value={row.code} required={required} maxLength={40} className={input} onChange={(event) => change(row.key, 'code', event.target.value)} />
      </label>
      <label className="min-w-0 text-xs text-muted">{valueLabel}
        <input name={valueName} type="number" min={min} step="any" required={required} value={row.value} className={`${input} font-mono`} onChange={(event) => change(row.key, 'value', event.target.value)} />
      </label>
      <button type="button" aria-label={`Retirer le code ${row.code || 'vide'}`} className="rounded-lg px-2 py-2 text-xs font-semibold text-clay" onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}>Retirer</button>
      {onSource && row.originalCode && <button type="button" className="col-span-3 justify-self-start text-xs font-semibold text-cyan underline" onClick={() => onSource(row.originalCode)}>Voir la ligne source de {row.originalCode}</button>}
    </div>)}
    <button type="button" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-cyan" onClick={() => {
      const key = nextKey.current++;
      setRows((previous) => [...previous, { key, code: '', value: '', originalCode: '' }]);
    }}>+ Ajouter un code</button>
  </div>;
}
