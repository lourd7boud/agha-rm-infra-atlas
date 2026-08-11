import { costToneClass, fmtMad, fmtPct, type ProjectCost } from '@/lib/projects';
import type { ProjectDetail } from '../types';

/** Top-of-page KPI cards + the Coût & Rentabilité breakdown. */
export function FinancialSummarySection({
  project,
  cost,
}: {
  project: ProjectDetail;
  cost: ProjectCost;
}) {
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Montant du marché
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantMarcheMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Travaux réalisés
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantCumuleMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Avancement
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {project.avancementPct.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Retenue de garantie
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.retenueCumuleeMad)}
          </p>
        </div>
      </div>

      <section className="mb-8 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Coût &amp; Rentabilité
          </h2>
          <span
            className={`font-mono text-sm font-bold tabular-nums ${costToneClass(cost.margePct)}`}
          >
            marge {fmtPct(cost.margePct)}
          </span>
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Budget (montant marché)
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {fmtMad(cost.budgetMad)}
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Matériaux
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums text-ink-2">
              {fmtMad(cost.materialsCostMad)}
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Main-d&apos;œuvre
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums text-ink-2">
              {fmtMad(cost.laborCostMad)}
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Dépenses
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums text-clay">
              {fmtMad(cost.expensesMad)}
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Coût total
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {fmtMad(cost.coutTotalMad)}
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Restant
            </p>
            <p
              className={`mt-2 font-mono text-lg font-bold tabular-nums ${costToneClass(cost.restantMad)}`}
            >
              {fmtMad(cost.restantMad)}
            </p>
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-faint">
          Coût total = matériaux consommés + main-d&apos;œuvre due + dépenses.
          Restant = budget − coût total ; marge = restant ÷ budget.
        </p>
      </section>
    </>
  );
}
