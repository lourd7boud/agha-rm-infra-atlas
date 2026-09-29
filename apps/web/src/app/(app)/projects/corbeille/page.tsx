// Corbeille — marchés supprimés (soft delete), restaurables d'un clic.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtDate, fmtMad, type BtpProject } from '@/lib/btp';
import { restoreProject } from '../[id]/actions';

export const metadata = { title: 'Corbeille — Projets BTP' };

export default async function CorbeillePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const projects = await apiGet<BtpProject[]>('/btp/projects/corbeille');
  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Marchés de travaux
      </Link>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Corbeille</h1>
      <p className="mt-1 text-sm text-muted">
        Les marchés supprimés restent restaurables — leurs bordereaux, métrés, décomptes et
        documents sont conservés.
      </p>

      {query.restored && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Marché restauré.
        </div>
      )}

      {projects.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-paper-2 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-muted">La corbeille est vide.</p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Marché</th>
                <th className="px-4 py-3">Objet</th>
                <th className="px-4 py-3 text-right">Montant (TTC)</th>
                <th className="px-4 py-3">Supprimé le</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((project) => (
                <tr key={project.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3 font-mono text-sm font-bold text-cyan">
                    {project.reference}
                  </td>
                  <td className="max-w-96 truncate px-4 py-3 text-xs text-muted">
                    {project.objet ?? project.name}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(project.montantMarcheMad)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtDate(project.deletedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={restoreProject}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <button className="rounded-lg bg-emerald-soft px-3 py-1.5 text-xs font-bold text-emerald transition hover:bg-emerald hover:text-paper">
                        ↩ Restaurer
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
