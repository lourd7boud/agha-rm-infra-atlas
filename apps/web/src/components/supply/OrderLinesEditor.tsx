'use client';

import { useState } from 'react';

/**
 * Client-side multi-line editor for a new bon de commande. Lines live in
 * component state; on submit they are serialized into a single hidden `lines`
 * field (JSON) that the page's 'use server' action parses and forwards to POST
 * /supply/orders. The running total mirrors the backend roll-up (Σ qty × unit
 * price) — bons de commande carry no TVA, so the amount is the HT line sum.
 * Mirrors the sales QuoteLinesEditor shape, minus the TVA controls.
 */

/** A draft line in the create-order editor (before the server prices it). */
interface DraftLine {
  /** Stable identity for React reconciliation across add/remove (not submitted). */
  key: string;
  designation: string;
  quantity: string;
  unit: string;
  unitPriceMad: string;
}

/** A fresh draft line with a stable key — index keys mis-reconcile on remove. */
function emptyLine(): DraftLine {
  return {
    key: Math.random().toString(36).slice(2),
    designation: '',
    quantity: '',
    unit: '',
    unitPriceMad: '',
  };
}

function lineSubtotal(line: DraftLine): number {
  const qty = Number(line.quantity);
  const price = Number(line.unitPriceMad);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return qty * price;
}

function fmtMadLocal(value: number): string {
  return `${value.toLocaleString('fr-MA', { maximumFractionDigits: 2 })} MAD`;
}

export function OrderLinesEditor() {
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current,
    );
  }

  const total = lines.reduce((sum, line) => sum + lineSubtotal(line), 0);

  // Only fully-filled lines are serialized — the server rejects empty lines.
  const serializedLines = JSON.stringify(
    lines
      .filter(
        (line) =>
          line.designation.trim().length > 0 &&
          line.quantity.trim().length > 0 &&
          line.unitPriceMad.trim().length > 0,
      )
      .map((line, index) => ({
        designation: line.designation.trim(),
        quantity: Number(line.quantity),
        unit: line.unit.trim() || undefined,
        unitPriceMad: Number(line.unitPriceMad),
        orderIndex: index,
      })),
  );

  return (
    <div className="space-y-3">
      <input type="hidden" name="lines" value={serializedLines} />

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2 w-24 text-right">Quantité</th>
              <th className="px-3 py-2 w-20">Unité</th>
              <th className="px-3 py-2 w-32 text-right">P.U. (MAD)</th>
              <th className="px-3 py-2 w-32 text-right">Total</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((line) => (
              <tr key={line.key}>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={line.designation}
                    onChange={(event) =>
                      updateLine(line.key, { designation: event.target.value })
                    }
                    maxLength={500}
                    placeholder="Fourniture / prestation"
                    className="w-full rounded-md border border-line-2 px-2.5 py-1.5 text-sm focus:border-cyan focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                    min={0}
                    step="0.001"
                    className="w-full rounded-md border border-line-2 px-2.5 py-1.5 text-right text-sm tabular-nums focus:border-cyan focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={line.unit}
                    onChange={(event) =>
                      updateLine(line.key, { unit: event.target.value })
                    }
                    maxLength={20}
                    placeholder="u"
                    className="w-full rounded-md border border-line-2 px-2.5 py-1.5 text-sm focus:border-cyan focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={line.unitPriceMad}
                    onChange={(event) =>
                      updateLine(line.key, { unitPriceMad: event.target.value })
                    }
                    min={0}
                    step="0.01"
                    className="w-full rounded-md border border-line-2 px-2.5 py-1.5 text-right text-sm tabular-nums focus:border-cyan focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-muted">
                  {fmtMadLocal(lineSubtotal(line))}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 1}
                    aria-label="Supprimer la ligne"
                    className="rounded-md border border-line-2 px-2 py-1 text-xs text-muted transition hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-line-2 px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-sand"
        >
          + Ajouter une ligne
        </button>

        <div className="rounded-lg border border-line bg-sand/40 px-4 py-2 text-right text-sm">
          <div className="flex justify-between gap-8 font-semibold">
            <span>Montant total</span>
            <span className="font-mono tabular-nums">{fmtMadLocal(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
