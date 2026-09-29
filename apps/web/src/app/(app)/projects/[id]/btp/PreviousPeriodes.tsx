'use client';

// Périodes précédentes d'un prix de bordereau — résumé en lecture seule avec
// repli/dépliage des mesures réellement enregistrées. Les détails arrivent
// déjà avec le contexte du métré (previousByLigne, chargé en une fois côté
// serveur) : le dépliage est purement local — aucune requête, aucun recalcul
// des totaux, cumuls, TVA ou retenue. Aucun champ n'est éditable ici.
import { useId, useState } from 'react';
import { metreCalcType } from '@/lib/btp-shared';
import {
  DIMENSION_COLUMNS,
  fmtMetreColumn,
  fmtMetreQty,
  hasPreviousLignes,
  previousLignePartiel,
  type MetrePreviousPeriode,
} from '@/lib/metre-details';

export function PreviousPeriodes({
  unite,
  previous,
}: {
  unite: string;
  previous: MetrePreviousPeriode[];
}) {
  const uid = useId();
  const [openPeriodes, setOpenPeriodes] = useState<Record<number, boolean>>({});

  if (previous.length === 0) return null;

  const hasDetails = hasPreviousLignes(previous);

  return (
    <div className="mb-3 rounded-lg border border-line bg-paper px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-faint">
        Périodes précédentes (lecture seule)
      </p>
      <ul className="mt-1 space-y-1">
        {previous.map((p) => {
          const canExpand = p.lignes.length > 0;
          const isOpen = canExpand && Boolean(openPeriodes[p.periodeNumero]);
          const detailsId = `${uid}-p${p.periodeNumero}`;
          return (
            <li key={p.periodeNumero}>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                <span className="rounded bg-sand px-1.5 py-0.5 font-bold">
                  P{p.periodeNumero}
                </span>
                <span>{p.lignes.length} mesure(s)</span>
                <span className="ml-auto tabular-nums">partiel {fmtMetreQty(p.totalPartiel)}</span>
                {canExpand && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPeriodes((prev) => ({
                        ...prev,
                        [p.periodeNumero]: !prev[p.periodeNumero],
                      }))
                    }
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    className="rounded-md border border-line bg-sand/60 px-2 py-0.5 text-[10px] font-bold text-ink-2 transition hover:border-cyan hover:text-cyan"
                  >
                    <span className="mr-1 text-faint">{isOpen ? '▾' : '▸'}</span>
                    {isOpen ? 'Masquer les détails' : 'Afficher les détails'}
                  </button>
                )}
              </div>
              {isOpen && (
                <div id={detailsId} className="mt-1.5 overflow-x-auto">
                  <PreviousPeriodeTable unite={unite} periode={p} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!hasDetails && (
        <p className="mt-1 text-[10px] text-faint">
          Aucune mesure détaillée enregistrée pour ces périodes.
        </p>
      )}
    </div>
  );
}

/**
 * Tableau (lecture seule) des mesures réellement enregistrées d'une période
 * antérieure — mêmes colonnes que la saisie de la période courante, adaptées à
 * l'unité du prix. Réutilisable tel quel (aucun état, aucune requête).
 */
export function PreviousPeriodeTable({
  unite,
  periode,
}: {
  unite: string;
  periode: MetrePreviousPeriode;
}) {
  const columns = DIMENSION_COLUMNS[metreCalcType(unite)];
  return (
    <table className="w-full min-w-[520px] text-left text-xs">
      <thead className="text-[10px] uppercase tracking-wider text-faint">
        <tr>
          <th className="px-2 py-1.5">Désignation</th>
          {columns.map((col) => (
            <th
              key={String(col.field)}
              title={col.hint}
              className="w-24 px-2 py-1.5 text-right"
            >
              {col.label}
            </th>
          ))}
          <th className="w-24 px-2 py-1.5 text-right">Partiel</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/50">
        {periode.lignes.map((ligne, index) => (
          <tr key={ligne.id ?? `p${periode.periodeNumero}-${index}`}>
            <td className="max-w-[16rem] px-2 py-1 text-ink-2">
              {ligne.designation?.trim() ? (
                ligne.designation
              ) : (
                <span className="text-faint">—</span>
              )}
            </td>
            {columns.map((col) => (
              <td
                key={String(col.field)}
                className="px-2 py-1 text-right font-mono tabular-nums text-muted"
              >
                {fmtMetreColumn(col, ligne)}
              </td>
            ))}
            <td className="px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald">
              {fmtMetreQty(previousLignePartiel(unite, ligne))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
