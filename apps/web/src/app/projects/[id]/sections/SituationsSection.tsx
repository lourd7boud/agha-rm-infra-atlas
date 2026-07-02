import {
  fmtMad,
  SITUATION_NEXT,
  SITUATION_STATUS_BADGES,
} from '@/lib/projects';
import type { ProjectDetail, ProjectFormAction } from '../types';

/** Situations de travaux table with per-row status transitions. */
export function SituationsSection({
  project,
  transitionSituation,
}: {
  project: ProjectDetail;
  transitionSituation: ProjectFormAction;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
        Situations de travaux ({project.situations.length})
      </h2>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3">N°</th>
            <th className="px-4 py-3">Période</th>
            <th className="px-4 py-3 text-right">Cumulé</th>
            <th className="px-4 py-3 text-right">Période</th>
            <th className="px-4 py-3 text-right">Retenue</th>
            <th className="px-4 py-3 text-right">Net à payer</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {project.situations.map((situation) => {
            const sBadge = SITUATION_STATUS_BADGES[situation.status];
            const next = SITUATION_NEXT[situation.status];
            return (
              <tr key={situation.id}>
                <td className="px-4 py-3 font-mono font-bold">
                  {situation.numero}
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                  {new Date(situation.periodEnd).toLocaleDateString('fr-MA')}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtMad(situation.montantCumuleMad)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtMad(situation.montantPeriodeMad)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-cyan">
                  {fmtMad(situation.retenueGarantieMad)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                  {fmtMad(situation.netAPayerMad)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sBadge.classes}`}
                  >
                    {sBadge.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {next && (
                    <form action={transitionSituation}>
                      <input type="hidden" name="sid" value={situation.id} />
                      <input type="hidden" name="to" value={next} />
                      <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                        → {SITUATION_STATUS_BADGES[next].label}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {project.situations.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucune situation — la première apparaît après le démarrage des travaux.
        </p>
      )}
    </section>
  );
}

/** "Nouvelle situation de travaux" form — rendered only while en_cours. */
export function NewSituationSection({
  createSituation,
}: {
  createSituation: ProjectFormAction;
}) {
  return (
    <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
        Nouvelle situation de travaux
      </h2>
      <form action={createSituation} className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">
            Fin de période
          </span>
          <input
            type="date"
            name="periodEnd"
            required
            className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">
            Montant cumulé des travaux (MAD)
          </span>
          <input
            type="number"
            name="montantCumuleMad"
            required
            min={0}
            step="0.01"
            className="w-56 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
          />
        </label>
        <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
          Calculer le décompte
        </button>
      </form>
      <p className="mt-3 text-xs text-faint">
        Retenue de garantie 10% plafonnée à 7% du marché — calcul automatique
        (CCAG-T, hypothèses v1).
      </p>
    </section>
  );
}
