import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  fmtMad,
  PROJECT_STATUS_BADGES,
  type ProjectSummary,
} from '@/lib/projects';

export default async function ProjectsPage() {
  const projects = await apiGet<ProjectSummary[]>('/project/projects');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Chantiers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Portefeuille des marchés en exécution — avancement et position
          financière
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {projects.map((project) => {
          const badge = PROJECT_STATUS_BADGES[project.status];
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-slate-400">
                  {project.reference}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
                >
                  {badge.label}
                </span>
              </div>
              <h2 className="mb-1 font-bold">{project.name}</h2>
              <p className="mb-4 text-sm text-slate-500">{project.buyerName}</p>

              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-mono tabular-nums text-slate-700">
                  {fmtMad(project.montantCumuleMad)}
                </span>
                <span className="font-mono tabular-nums text-slate-400">
                  / {fmtMad(project.montantMarcheMad)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, project.avancementPct)}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span>
                  {project.situationsCount} situation
                  {project.situationsCount > 1 ? 's' : ''}
                </span>
                <span className="font-mono tabular-nums">
                  {project.avancementPct.toFixed(1)}% · retenue{' '}
                  {fmtMad(project.retenueCumuleeMad)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {projects.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
          Aucun chantier enregistré — les marchés gagnés apparaissent ici.
        </p>
      )}
    </div>
  );
}
