// Éditeur de métré d'une période — le poste de saisie: bordereau → mesures →
// (à l'enregistrement) décompte auto. Les réglages de la période (dates, TVA,
// « et dernier ») vivent ici aussi.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtDate, type BtpProjectDetail, type MetreContext } from '@/lib/btp';
import { patchPeriode, saveMetres } from '../../actions';
import { MetreEditor } from '../../btp/MetreEditor';

export default async function MetreEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; periodeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, periodeId } = await params;
  const query = await searchParams;
  const [project, context] = await Promise.all([
    apiGet<BtpProjectDetail>(`/btp/projects/${id}`),
    apiGet<MetreContext>(`/btp/projects/${id}/periodes/${periodeId}/metres`),
  ]);
  const periode = context.periode;
  const saved = query.saved === '1';
  const errored = Boolean(query.error);

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link
        href={`/projects/${id}?tab=metres`}
        className="text-xs font-semibold text-muted hover:text-cyan"
      >
        ← {project.reference} · Métrés
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Métré n°{periode.numero}
            {periode.isDecompteDernier && (
              <span className="ml-2 rounded-full bg-emerald-soft px-2.5 py-1 align-middle text-xs font-bold text-emerald">
                décompte et dernier
              </span>
            )}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {periode.libelle ?? `Période ${periode.numero}`} · {fmtDate(periode.dateDebut)} →{' '}
            {fmtDate(periode.dateFin)} · TVA {periode.tauxTva}% · retenue {periode.tauxRetenue}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/btp-export/${id}/attachement?periodeId=${periodeId}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-emerald hover:text-emerald"
          >
            ⬇ Attachement Excel
          </a>
          <Link
            href={`/projects/${id}/attachement?periodeId=${periodeId}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            Attachement (imprimable)
          </Link>
          <Link
            href={`/projects/${id}?tab=decomptes`}
            className="rounded-lg bg-cyan-soft px-3 py-2 text-xs font-bold text-cyan transition hover:bg-cyan hover:text-paper"
          >
            Voir les décomptes →
          </Link>
        </div>
      </div>

      {saved && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Métré enregistré — le décompte n°{periode.numero} a été régénéré automatiquement.
        </div>
      )}
      {errored && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay"
        >
          Échec de l'enregistrement ({query.code ?? 'failed'}) — le décompte est peut-être
          validé/payé (métré verrouillé).
        </div>
      )}

      {/* Réglages période */}
      <details className="mt-5 rounded-xl border border-line bg-paper-2 shadow-sm">
        <summary className="cursor-pointer select-none px-5 py-3 text-xs font-semibold uppercase tracking-widest text-cyan">
          ⚙ Réglages de la période (dates, TVA, retenue, « et dernier »)
        </summary>
        <form
          action={patchPeriode}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <input type="hidden" name="projectId" value={id} />
          <input type="hidden" name="periodeId" value={periodeId} />
          <input type="hidden" name="backTo" value={`/projects/${id}/metres/${periodeId}`} />
          <input type="hidden" name="isDecompteDernierFlag" value="1" />
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Libellé
            <input
              name="libelle"
              defaultValue={periode.libelle ?? ''}
              className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Du
            <input
              type="date"
              name="dateDebut"
              defaultValue={periode.dateDebut?.slice(0, 10) ?? ''}
              className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Au
            <input
              type="date"
              name="dateFin"
              defaultValue={periode.dateFin?.slice(0, 10) ?? ''}
              className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            TVA %
            <input
              type="number"
              step="0.01"
              name="tauxTva"
              defaultValue={periode.tauxTva}
              className="mt-1 block w-24 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Retenue %
            <input
              type="number"
              step="0.01"
              name="tauxRetenue"
              defaultValue={periode.tauxRetenue}
              className="mt-1 block w-24 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-muted">
            <input
              type="checkbox"
              name="isDecompteDernier"
              defaultChecked={periode.isDecompteDernier}
              className="accent-emerald"
            />
            Décompte et dernier (active la révision)
          </label>
          <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
            Enregistrer les réglages
          </button>
        </form>
      </details>

      {/* Éditeur */}
      <div className="mt-5">
        {context.bordereau && context.bordereau.lignes.length > 0 ? (
          <MetreEditor projectId={id} periodeId={periodeId} context={context} action={saveMetres} />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-14 text-center">
            <p className="text-sm font-semibold text-muted">Le bordereau est vide.</p>
            <Link
              href={`/projects/${id}?tab=bordereau`}
              className="mt-2 inline-block rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper"
            >
              Saisir le bordereau d'abord →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
