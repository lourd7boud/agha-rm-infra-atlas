import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtDate, fmtMadPrecise, type BtpProjectDetail, type RevisionTableRow, type RevisionView } from '@/lib/btp';
import { patchPeriode } from '../actions';
import { RevisionConfigForm } from './RevisionConfigForm';
import { RevisionReportTables } from './RevisionReportTables';

const legalReference = 'https://www.tgr.gov.ma/wps/wcm/connect/ba8d2d36-6f23-4228-9466-552f6d123291/arrete%203-302-15%20revision%20des%20prix%20des%20marches.pdf?MOD=AJPERES';
const field = 'mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm';
const money = (amount: number | null | undefined) => amount == null ? 'En attente' : fmtMadPrecise(amount);

function AllocationForm({ row, projectId, months }: { row: RevisionTableRow; projectId: string; months: string[] }) {
  const period = row.periode;
  if (!period || ['validated', 'paid'].includes(row.statut) || (months.length < 2 && !period.revisionMonthlyHt)) return null;
  return (
    <form action={patchPeriode} className="space-y-3 rounded-lg border border-line p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="periodeId" value={period.id} />
      <input type="hidden" name="backTo" value={`/projects/${projectId}?section=admin&tab=revision`} />
      <p className="text-sm font-semibold">Décompte n°{row.numero}</p>
      <label className="block text-sm">Répartition du HT exécuté
        <select name="revisionMonthlyMode" defaultValue={period.revisionMonthlyHt ? 'monthly' : 'calendar'} className={field}>
          <option value="calendar">Automatique · attachements datés, sinon prorata des jours</option>
          <option value="monthly">Montants réellement exécutés par mois</option>
        </select>
      </label>
      <div className="grid grid-cols-4 gap-3">
        {months.map((month) => <label key={month} className="text-xs">{month}
          <input name={`revision-month:${month}`} type="number" step="0.01" defaultValue={period.revisionMonthlyHt?.[month]} placeholder="HT en MAD" className={field} />
        </label>)}
      </div>
      <button className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-cyan">Enregistrer la répartition</button>
    </form>
  );
}

export async function RevisionTab({ project }: { project: BtpProjectDetail }) {
  const view = await apiGet<RevisionView>(`/btp/projects/${project.id}/revision`);
  const { config, report } = view;
  const ready = !!config?.isEnabled && !!view.formula;
  const mode = project.modePassation?.normalize('NFD').replace(/\p{M}/gu, '') ?? '';
  const negotiated = project.typeMarche === 'negocie' || /negoci/i.test(mode);
  const hasRows = !!report?.rows.length;
  const status = !ready ? 'Formule du CPS à enregistrer' : !hasRows ? 'En attente du premier métré'
    : report?.summary.pendingCount ? 'Calcul à compléter' : report?.warnings.length ? 'Calcul indicatif' : 'Révision calculée';
  const exportBase = `/api/btp-export/${project.id}/revision`;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Révision des prix</h2>
          <p className="mt-1 text-sm text-muted">{project.reference} · {report?.mode === 'final_only' ? 'Report au décompte « et dernier »' : 'Report à chaque décompte'}</p>
        </div>
        <div className="flex items-center gap-2">
          {ready && hasRows && <>
            <a href={`${exportBase}.xlsx`} className="rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-paper">Exporter Excel</a>
            <a href={`${exportBase}.pdf`} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-paper-2 px-4 py-2.5 text-sm font-semibold text-cyan">Afficher le PDF</a>
          </>}
          <Link href="/projects/indexes" className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-muted">Registre des indices</Link>
        </div>
      </header>

      <section className={`rounded-xl border border-line border-l-4 bg-paper-2 px-5 py-4 ${ready && !report?.summary.pendingCount && !report?.warnings.length ? 'border-l-emerald' : 'border-l-ochre'}`}>
        <div className="flex items-start justify-between gap-5">
          <div>
            <h3 className="font-semibold">{status}</h3>
            {report && <p className="mt-1 text-xs text-muted">État calculé au {fmtDate(report.cutoff)} · Référence du marché {fmtDate(report.baseDate)}</p>}
            {!ready && <p className="mt-2 text-sm text-muted">Enregistrez la formule une fois pour calculer les périodes depuis les métrés et les indices du registre.</p>}
          </div>
          {report && hasRows && <dl className="flex gap-10 text-right">
            <div><dt className="text-xs text-muted">Révision totale HT</dt><dd className="mt-1 text-xl font-bold tabular-nums">{money(report.summary.calculatedTotal)}</dd></div>
            <div><dt className="text-xs text-muted">Intégrée aux décomptes HT</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(report.summary.postedTotal)}</dd></div>
            <div><dt className="text-xs text-muted">Solde à intégrer HT</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-cyan">{money(report.summary.balance)}</dd></div>
          </dl>}
        </div>
        {!!report?.warnings.length && <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
          {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>}
      </section>

      <details open={!ready || undefined} className="rounded-xl border border-line bg-paper-2">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Formule du CPS et mode de report</summary>
        <div className="border-t border-line p-5">
          <div className="max-w-2xl">
            <RevisionConfigForm key={`${config?.formulaId ?? 'new'}:${config?.isEnabled ?? false}:${config?.postingMode ?? 'each_decompte'}`} projectId={project.id} view={view} negotiated={negotiated} />
          </div>
        </div>
      </details>

      {report && <RevisionReportTables report={report} projectId={project.id} />}

      {ready && report?.rows.some((row) => row.months.length > 1 && !['validated', 'paid'].includes(row.statut)) && <details className="rounded-xl border border-line bg-paper-2">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Répartition réelle des travaux par mois</summary>
        <div className="space-y-3 border-t border-line p-5">
          {view.table.map((row) => <AllocationForm key={row.decompteId} row={row} projectId={project.id}
            months={[...new Set(report.rows.find((item) => item.decompteId === row.decompteId)?.months.map((month) => month.month) ?? [])]} />)}
        </div>
      </details>}
      <a href={legalReference} target="_blank" rel="noreferrer" className="inline-block text-xs text-muted underline underline-offset-2">
        Arrêté n° 3-302-15 · articles 4, 8 et 12 à 18
      </a>
    </div>
  );
}
