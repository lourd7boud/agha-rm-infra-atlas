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
    <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href={`/projects/${id}?tab=metres`}
        className="inline-flex items-center gap-2 text-xs font-medium text-muted transition hover:text-cyan"
      >
        ← {project.reference} · Métrés
      </Link>

      <div className="mb-6 mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan">Suivi des travaux · Saisie des quantités</p>
          <h1 className="text-3xl font-bold tracking-tight text-ink">
            Métré n°{periode.numero}
            {periode.isDecompteDernier && (
              <span className="ml-2 rounded-full bg-emerald-soft px-2.5 py-1 align-middle text-xs font-bold text-emerald">
                décompte et dernier
              </span>
            )}
          </h1>
          <p className="mt-2 text-xs text-muted">
            {periode.libelle ?? `Période ${periode.numero}`} · Depuis le {fmtDate(periode.dateDebut)} au{' '}
            {fmtDate(periode.dateFin)} · TVA {periode.tauxTva}% · retenue {periode.tauxRetenue}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-lg border border-line bg-paper-2 px-4 py-2.5 text-xs font-semibold text-ink-2 transition hover:border-cyan">Exporter / Imprimer <span className="ml-2 text-faint">▾</span></summary>
            <div className="absolute left-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-xl border border-line bg-paper-2 p-2 shadow-lg sm:left-auto sm:right-0 [&_a]:rounded-lg [&_a]:border-0 [&_a]:bg-transparent [&_a]:px-3 [&_a]:py-2.5 [&_a]:text-left [&_a]:text-xs [&_a]:font-medium [&_a]:text-ink-2 [&_a:hover]:bg-sand">
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
          </Link>          <a
            href={`/api/btp-export/${id}/metre.xlsx?periodeId=${periodeId}`}
            className="rounded-lg bg-emerald px-3 py-2 text-xs font-bold text-paper transition hover:opacity-90"
          >
            ⬇ Métré Excel
          </a>
          <a
            href={`/api/btp-export/${id}/metre.pdf?periodeId=${periodeId}`}
            className="rounded-lg bg-clay px-3 py-2 text-xs font-bold text-paper transition hover:opacity-90"
          >
            ⬇ Métré PDF
          </a>
            <p className="border-t border-line px-3 pt-2 text-[10px] leading-relaxed text-muted">Les exports reprennent les dernières données enregistrées.</p>
            </div>
          </details>
          <Link
            href={context.decompteId ? `/projects/${id}/decomptes/${context.decompteId}` : `/projects/${id}?tab=decomptes`}
            className="rounded-lg bg-cyan-soft px-4 py-2.5 text-xs font-semibold text-cyan transition hover:bg-cyan hover:text-paper"
          >
            {context.decompteId ? `Voir le décompte n°${periode.numero}` : 'Voir les décomptes'} →
          </Link>
        </div>
      </div>

      {saved && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Métré enregistré. Le décompte n°{periode.numero} reprend ses quantités et sa date d’arrêté.
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
      <details className="group mt-5 rounded-xl border border-line bg-paper-2">
        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-4 py-3.5 text-xs text-muted">
          <span><span className="mr-2 font-semibold text-ink-2">Paramètres du métré</span><span className="hidden sm:inline">Date d’arrêté, TVA, retenue et décompte final</span></span><span className="font-semibold text-cyan group-open:hidden">Modifier ▾</span><span className="hidden font-semibold text-cyan group-open:inline">Fermer ▴</span>
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
          <div className="pb-2 text-xs text-muted">
            Depuis le <span className="font-mono text-ink-2">{fmtDate(periode.dateDebut)}</span>
          </div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Travaux arrêtés au
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
            Décompte et dernier
          </label>
          <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
            Enregistrer les réglages
          </button>
        </form>
      </details>

      {/* Éditeur */}
      <div className="mt-5">
        {context.bordereau && context.bordereau.lignes.length > 0 ? (
          <MetreEditor key={`${id}:${periodeId}`} projectId={id} periodeId={periodeId} context={context} action={saveMetres} saveFeedback={errored ? 'error' : saved ? 'saved' : undefined} />
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
