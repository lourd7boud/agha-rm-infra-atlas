// Gestion des délais — l'échéancier du portefeuille: OSC + délai contractuel
// + arrêts ⇒ fin effective, jours restants et statut (normal/alerte/critique/
// dépassé/terminé), calculés par le moteur.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { DELAI_STATUS_BADGES, fmtDate, type DelaiOverviewRow } from '@/lib/btp';

export const metadata = { title: 'Gestion des délais — Projets BTP' };

const STATUS_ORDER = ['overdue', 'critical', 'warning', 'normal', 'completed', 'unknown'] as const;

export default async function DelaisPage() {
  const rows = await apiGet<DelaiOverviewRow[]>('/btp/projects/delais');
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.delai.status, (counts.get(row.delai.status) ?? 0) + 1);
  const sorted = [...rows].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.delai.status as (typeof STATUS_ORDER)[number]) -
      STATUS_ORDER.indexOf(b.delai.status as (typeof STATUS_ORDER)[number]),
  );

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Marchés de travaux
      </Link>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Gestion des délais</h1>
      <p className="mt-1 text-sm text-muted">
        Fin effective = O.S.C + délai contractuel + jours d'arrêt. Seuils : alerte ≤ 30 j, critique
        ≤ 15 j.
      </p>

      {/* Compteurs */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_ORDER.map((status) => {
          const badge = DELAI_STATUS_BADGES[status] ?? { label: status, classes: 'bg-sand' };
          return (
            <div
              key={status}
              className="rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}
              >
                {badge.label}
              </span>
              <p className="mt-2 font-mono text-lg font-bold tabular-nums">
                {counts.get(status) ?? 0}
              </p>
            </div>
          );
        })}
      </div>

      <section className="mt-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Marché</th>
              <th className="px-4 py-3">O.S.C</th>
              <th className="px-4 py-3 text-right">Délai</th>
              <th className="px-4 py-3 text-right">Arrêts</th>
              <th className="px-4 py-3">Fin effective</th>
              <th className="px-4 py-3 text-right">Restant</th>
              <th className="px-4 py-3">Avancement délai</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map(({ project, delai }) => {
              const badge = DELAI_STATUS_BADGES[delai.status] ?? {
                label: delai.status,
                classes: 'bg-sand text-muted',
              };
              return (
                <tr key={project.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${project.id}?tab=apercu`}
                      className="font-mono text-sm font-bold text-cyan hover:underline"
                    >
                      {project.reference}
                    </Link>
                    <p className="max-w-72 truncate text-[11px] text-faint">{project.objet}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {fmtDate(project.ordreServiceDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {project.delaiMois ? `${project.delaiMois} mois` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {delai.joursArret} j{delai.enArret ? ' ⏸' : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtDate(delai.dateFinEffective)}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono text-xs font-bold tabular-nums ${
                      delai.joursRestants < 0 ? 'text-clay' : 'text-emerald'
                    }`}
                  >
                    {delai.status === 'unknown' ? '—' : `${delai.joursRestants} j`}
                  </td>
                  <td className="w-40 px-4 py-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-sand">
                      <div
                        className={`h-full rounded-full ${
                          delai.status === 'overdue' || delai.status === 'critical'
                            ? 'bg-clay'
                            : delai.status === 'warning'
                              ? 'bg-ochre'
                              : 'bg-cyan'
                        }`}
                        style={{ width: `${Math.min(100, delai.pourcentage)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
