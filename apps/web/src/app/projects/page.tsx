import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  costToneClass,
  fmtMad,
  fmtPct,
  PROJECT_STATUS_BADGES,
  type ProjectCostSummary,
  type ProjectSummary,
} from '@/lib/projects';

export default async function ProjectsPage() {
  // Portfolio + cost rollup in parallel; the rollup is one batched service call
  // (≈5 queries), joined per-card by projectId. A project missing from the
  // rollup falls back to no-cost display rather than breaking the card.
  const [projects, costSummary] = await Promise.all([
    apiGet<ProjectSummary[]>('/project/projects'),
    apiGet<ProjectCostSummary[]>('/project/projects/cost-summary'),
  ]);
  const costByProject = new Map<string, ProjectCostSummary>(
    costSummary.map((cost) => [cost.projectId, cost]),
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Chantiers</h1>
        <p className="mt-1 text-sm text-muted">
          Portefeuille des marchés en exécution — avancement et position
          financière
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {projects.map((project) => {
          const badge = PROJECT_STATUS_BADGES[project.status];
          const cost = costByProject.get(project.id);
          // Width of the cost-vs-budget bar; clamped, and 0 for a budget-less
          // chantier so the bar simply stays empty rather than dividing by zero.
          const coutPct =
            cost && cost.budgetMad > 0
              ? Math.min(100, (cost.coutTotalMad / cost.budgetMad) * 100)
              : 0;
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm transition hover:border-line-2 hover:shadow"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-faint">
                  {project.reference}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
                >
                  {badge.label}
                </span>
              </div>
              <h2 className="mb-1 font-bold">{project.name}</h2>
              <p className="mb-4 text-sm text-muted">{project.buyerName}</p>

              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-mono tabular-nums text-ink-2">
                  {fmtMad(project.montantCumuleMad)}
                </span>
                <span className="font-mono tabular-nums text-faint">
                  / {fmtMad(project.montantMarcheMad)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sand">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, project.avancementPct)}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-faint">
                <span>
                  {project.situationsCount} situation
                  {project.situationsCount > 1 ? 's' : ''}
                </span>
                <span className="font-mono tabular-nums">
                  {project.avancementPct.toFixed(1)}% · retenue{' '}
                  {fmtMad(project.retenueCumuleeMad)}
                </span>
              </div>

              {cost ? (
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 flex items-baseline justify-between text-xs">
                    <span className="text-faint">Coût engagé</span>
                    <span className="font-mono tabular-nums text-ink-2">
                      {fmtMad(cost.coutTotalMad)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sand">
                    <div
                      className={`h-full rounded-full ${
                        cost.restantMad < 0 ? 'bg-clay' : 'bg-cyan-deep'
                      }`}
                      style={{ width: `${coutPct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-xs">
                    <span className={`font-mono tabular-nums ${costToneClass(cost.restantMad)}`}>
                      Restant {fmtMad(cost.restantMad)}
                    </span>
                    <span className={`font-mono tabular-nums ${costToneClass(cost.margePct)}`}>
                      marge {fmtPct(cost.margePct)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="mt-4 border-t border-line pt-3 text-xs text-faint">
                  Coût indisponible
                </p>
              )}
            </Link>
          );
        })}
      </div>

      {projects.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-2 p-12 text-center text-sm text-faint">
          Aucun chantier enregistré — les marchés gagnés apparaissent ici.
        </p>
      )}
    </div>
  );
}
