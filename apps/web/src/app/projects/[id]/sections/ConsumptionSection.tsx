import { fmtMad } from '@/lib/projects';
import { fmtQty, type ProjectMaterialConsumption } from '@/lib/stock';

/** Matériaux consommés — stock exits attributed to this chantier, valued. */
export function ConsumptionSection({
  consumption,
  consumptionTotalMad,
}: {
  consumption: ProjectMaterialConsumption[];
  consumptionTotalMad: number;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Matériaux consommés ({consumption.length})
        </h2>
        <span className="text-xs text-muted">
          Coût total{' '}
          <strong className="font-mono tabular-nums text-ink-2">
            {fmtMad(consumptionTotalMad)}
          </strong>
        </span>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3">Matériau</th>
            <th className="px-4 py-3 text-right">Quantité</th>
            <th className="px-4 py-3 text-right">Coût valorisé</th>
            <th className="px-4 py-3">Sorties</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {consumption.map((row) => (
            <tr key={row.materialId}>
              <td className="px-4 py-3 font-semibold">{row.designation}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">
                {fmtQty(row.totalQuantity, row.unit)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {fmtMad(row.totalCostMad)}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-0.5">
                  {row.history.map((entry, index) => (
                    <li
                      key={`${row.materialId} ${index}`}
                      className="flex flex-wrap items-center gap-2 text-xs text-faint"
                    >
                      <span className="font-mono tabular-nums text-muted">
                        {new Date(entry.occurredAt).toLocaleDateString('fr-MA')}
                      </span>
                      <span className="font-mono tabular-nums">
                        {fmtQty(entry.quantity, row.unit)}
                      </span>
                      {entry.reference && (
                        <span className="font-mono">{entry.reference}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {consumption.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucune consommation — les sorties de stock affectées à ce chantier
          apparaissent ici.
        </p>
      )}
    </section>
  );
}
