'use client';

import { useId, useMemo, useState } from 'react';

/**
 * Reusable line editor for the Ventes documents (devis, factures, bons de
 * livraison). Manages rows in React state, serializes them into a single hidden
 * `lines` input as JSON, and (in priced mode) previews HT / TVA / TTC live as
 * the operator types. The parent server action parses the JSON and forwards it
 * to /sales/*. Kept presentation-only: no data fetching, no API calls.
 */

type EditorMode = 'priced' | 'delivery';

interface LineRow {
  key: string;
  designation: string;
  quantity: string;
  unit: string;
  unitPriceMad: string;
}

interface LineEditorProps {
  mode: EditorMode;
  /** Field name carrying the TVA percentage (priced mode only). */
  tvaFieldName?: string;
  defaultTvaPct?: number;
}

const PRICED_GRID = 'grid-cols-[1fr_5rem_4rem_7rem_2rem]';
const DELIVERY_GRID = 'grid-cols-[1fr_5rem_4rem_2rem]';

function emptyRow(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    designation: '',
    quantity: '1',
    unit: '',
    unitPriceMad: '',
  };
}

function fmt(value: number): string {
  return value.toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const INPUT =
  'w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-sm focus:border-cyan focus:outline-none';

export function LineEditor({
  mode,
  tvaFieldName = 'tvaPct',
  defaultTvaPct = 20,
}: LineEditorProps) {
  const tvaInputId = useId();
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);
  const [tvaPct, setTvaPct] = useState<string>(String(defaultTvaPct));
  const priced = mode === 'priced';

  function updateRow(key: string, patch: Partial<LineRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.key !== key) : current,
    );
  }

  // Serialized payload the server action parses — only well-formed rows.
  const serialized = useMemo(() => {
    const cleaned = rows
      .filter((row) => row.designation.trim().length > 0)
      .map((row, index) => ({
        designation: row.designation.trim(),
        quantity: Number(row.quantity) || 0,
        unit: row.unit.trim() || undefined,
        ...(priced ? { unitPriceMad: Number(row.unitPriceMad) || 0 } : {}),
        orderIndex: index,
      }));
    return JSON.stringify(cleaned);
  }, [rows, priced]);

  const totals = useMemo(() => {
    if (!priced) return null;
    const ht = rows.reduce((sum, row) => {
      const qty = Number(row.quantity) || 0;
      const price = Number(row.unitPriceMad) || 0;
      return sum + qty * price;
    }, 0);
    const pct = Number(tvaPct) || 0;
    const tva = (ht * pct) / 100;
    return { ht, tva, ttc: ht + tva };
  }, [rows, tvaPct, priced]);

  const grid = priced ? PRICED_GRID : DELIVERY_GRID;

  return (
    <div className="space-y-2">
      <input type="hidden" name="lines" value={serialized} />

      <div
        className={`grid ${grid} gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-faint`}
      >
        <span>Désignation</span>
        <span className="text-right">Quantité</span>
        <span>Unité</span>
        {priced && <span className="text-right">P.U. MAD</span>}
        <span />
      </div>

      {rows.map((row) => (
        <div key={row.key} className={`grid ${grid} items-center gap-2`}>
          <input
            type="text"
            aria-label="Désignation"
            value={row.designation}
            maxLength={500}
            onChange={(event) =>
              updateRow(row.key, { designation: event.target.value })
            }
            className={INPUT}
          />
          <input
            type="number"
            aria-label="Quantité"
            value={row.quantity}
            min={0}
            step="0.001"
            onChange={(event) =>
              updateRow(row.key, { quantity: event.target.value })
            }
            className={`${INPUT} text-right`}
          />
          <input
            type="text"
            aria-label="Unité"
            value={row.unit}
            maxLength={20}
            placeholder="u"
            onChange={(event) => updateRow(row.key, { unit: event.target.value })}
            className={INPUT}
          />
          {priced && (
            <input
              type="number"
              aria-label="Prix unitaire MAD"
              value={row.unitPriceMad}
              min={0}
              step="0.01"
              onChange={(event) =>
                updateRow(row.key, { unitPriceMad: event.target.value })
              }
              className={`${INPUT} text-right`}
            />
          )}
          <button
            type="button"
            aria-label="Retirer la ligne"
            onClick={() => removeRow(row.key)}
            disabled={rows.length === 1}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line-2 text-muted transition hover:bg-sand disabled:opacity-40"
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={addRow}
          className="rounded-md border border-line-2 px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-sand"
        >
          + Ajouter une ligne
        </button>

        {priced && totals && (
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted" id={tvaInputId}>
                TVA %
              </span>
              <input
                type="number"
                name={tvaFieldName}
                aria-labelledby={tvaInputId}
                value={tvaPct}
                min={0}
                max={100}
                step="0.01"
                onChange={(event) => setTvaPct(event.target.value)}
                className="w-20 rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-right text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <span className="text-muted">
              HT{' '}
              <strong className="font-mono tabular-nums text-ink-2">
                {fmt(totals.ht)}
              </strong>
            </span>
            <span className="text-muted">
              TVA{' '}
              <strong className="font-mono tabular-nums text-ink-2">
                {fmt(totals.tva)}
              </strong>
            </span>
            <span className="text-muted">
              TTC{' '}
              <strong className="font-mono tabular-nums text-cyan">
                {fmt(totals.ttc)}
              </strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
