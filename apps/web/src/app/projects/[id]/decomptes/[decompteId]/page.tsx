// Détail d'un décompte — lignes cumulées + récapitulatif fidèle (travaux,
// retenue de garantie, exercices antérieurs, montant de l'acompte), révision
// appliquée, circuit de statut draft → submitted → validated → paid.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  DECOMPTE_STATUS_BADGES,
  fmtDate,
  fmtMadPrecise,
  fmtQty,
  type BtpProjectDetail,
  type Decompte,
} from '@/lib/btp';
import { patchDecompte } from '../../actions';

const NEXT_DECOMPTE_STATUS: Record<string, { to: string; label: string; tone: string }[]> = {
  draft: [{ to: 'submitted', label: 'Soumettre', tone: 'bg-ochre-soft text-ochre' }],
  submitted: [
    { to: 'validated', label: 'Valider', tone: 'bg-cyan-soft text-cyan' },
    { to: 'draft', label: 'Repasser en brouillon', tone: 'bg-sand text-muted' },
  ],
  validated: [
    { to: 'paid', label: 'Marquer payé', tone: 'bg-emerald-soft text-emerald' },
    { to: 'draft', label: 'Déverrouiller (brouillon)', tone: 'bg-sand text-muted' },
  ],
  paid: [],
};

export default async function DecompteDetailPage({
  params,
}: {
  params: Promise<{ id: string; decompteId: string }>;
}) {
  const { id, decompteId } = await params;
  const [project, decompte] = await Promise.all([
    apiGet<BtpProjectDetail>(`/btp/projects/${id}`),
    apiGet<Decompte>(`/btp/projects/${id}/decomptes/${decompteId}`),
  ]);
  const badge = DECOMPTE_STATUS_BADGES[decompte.statut] ?? {
    label: decompte.statut,
    classes: 'bg-sand text-muted',
  };
  const statusActions = NEXT_DECOMPTE_STATUS[decompte.statut] ?? [];
  const title = decompte.isDernier
    ? `Décompte n°${decompte.numero} et dernier`
    : `Décompte provisoire n°${decompte.numero}`;

  const recap: { label: string; value: number; strong?: boolean; tone?: string }[] = [
    ...(decompte.isDernier
      ? [{ label: 'Travaux terminés (TTC)', value: decompte.totalTtcMad }]
      : [{ label: 'Travaux non terminés (TTC)', value: decompte.totalTtcMad }]),
    { label: 'Total HT cumulé', value: decompte.totalHtMad },
    ...(decompte.revisionMontantMad !== 0
      ? [
          {
            label: 'Révision des prix (+HT)',
            value: decompte.revisionMontantMad,
            tone: 'text-cyan',
          },
        ]
      : []),
    { label: `TVA ${decompte.tauxTva}%`, value: decompte.montantTvaMad },
    { label: 'Total TTC cumulé', value: decompte.totalTtcMad, strong: true },
    { label: 'Retenue de garantie', value: -decompte.retenueGarantieMad, tone: 'text-ochre' },
    {
      label: 'Dépenses des exercices antérieurs',
      value: -decompte.depensesAnterieuresMad,
      tone: 'text-muted',
    },
    {
      label: "Acomptes délivrés (exercice en cours)",
      value: -decompte.decomptesPrecedentsMad,
      tone: 'text-muted',
    },
  ];

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link
        href={`/projects/${id}?tab=decomptes`}
        className="text-xs font-semibold text-muted hover:text-cyan"
      >
        ← {project.reference} · Décomptes
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{title}</h1>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
              {badge.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {decompte.periode?.libelle ?? '—'} ·{' '}
            {decompte.periode
              ? `${fmtDate(decompte.periode.dateDebut)} → ${fmtDate(decompte.periode.dateFin)}`
              : ''}
            {decompte.dateDecompte ? ` · établi le ${fmtDate(decompte.dateDecompte)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/btp-export/${id}/decompte?decompteId=${decompteId}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-emerald hover:text-emerald"
          >
            ⬇ Export Excel
          </a>
          {decompte.periodeId && (
            <Link
              href={`/projects/${id}/metres/${decompte.periodeId}`}
              className="rounded-lg bg-cyan-soft px-3 py-2 text-xs font-bold text-cyan transition hover:bg-cyan hover:text-paper"
            >
              Ouvrir le métré source →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Lignes */}
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm xl:col-span-2">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Lignes (quantités réalisées cumulées)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">N°</th>
                  <th className="px-4 py-3">Désignation</th>
                  <th className="px-4 py-3">U</th>
                  <th className="px-4 py-3 text-right">Qté marché</th>
                  <th className="px-4 py-3 text-right">Qté réalisée</th>
                  <th className="px-4 py-3 text-right">P.U. HT</th>
                  <th className="px-4 py-3 text-right">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {decompte.lignes.map((ligne) => {
                  const over = ligne.quantiteRealisee > ligne.quantiteBordereau;
                  return (
                    <tr key={ligne.bordereauLigneId} className="transition hover:bg-sand/40">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-cyan">
                        {ligne.prixNo}
                      </td>
                      <td className="max-w-80 px-4 py-2.5 text-xs">{ligne.designation}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">{ligne.unite}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-faint">
                        {fmtQty(ligne.quantiteBordereau)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-xs font-bold tabular-nums ${over ? 'text-clay' : ''}`}
                      >
                        {fmtQty(ligne.quantiteRealisee)}
                        {over ? ' ⚠' : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {fmtQty(ligne.prixUnitaireHT)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                        {fmtMadPrecise(ligne.montantHT)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Récapitulatif */}
        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Récapitulatif
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {recap.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className={`text-xs ${row.strong ? 'font-bold text-ink-2' : 'text-muted'}`}>
                    {row.label}
                  </dt>
                  <dd
                    className={`font-mono tabular-nums ${row.strong ? 'font-bold' : ''} ${row.tone ?? ''}`}
                  >
                    {row.value < 0 ? '− ' : ''}
                    {fmtMadPrecise(Math.abs(row.value))}
                  </dd>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
                <dt className="text-xs font-bold uppercase tracking-widest text-emerald">
                  Montant de l'acompte à délivrer
                </dt>
                <dd className="font-mono text-lg font-black tabular-nums text-emerald">
                  {fmtMadPrecise(decompte.montantAcompteMad)}
                </dd>
              </div>
            </dl>
          </section>

          {/* Révision */}
          {decompte.revision && (
            <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
                Révision des prix appliquée
              </h2>
              <dl className="mt-3 space-y-1.5 text-xs text-muted">
                <div className="flex justify-between">
                  <dt>Montant à réviser (HT cumulé)</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtMadPrecise(decompte.revision.montantAReviser ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Coefficient appliqué</dt>
                  <dd className="font-mono tabular-nums">
                    {decompte.revision.coefficient?.toFixed(4) ?? '—'}
                  </dd>
                </div>
                <div className="flex justify-between font-semibold text-cyan">
                  <dt>Montant de la révision</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtMadPrecise(decompte.revision.montantRevision ?? 0)}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {/* Statut & date */}
          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Circuit du décompte
            </h2>
            <div className="mt-3 space-y-2">
              {statusActions.map((action) => (
                <form key={action.to} action={patchDecompte}>
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="decompteId" value={decompteId} />
                  <input type="hidden" name="statut" value={action.to} />
                  <button
                    className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80 ${action.tone}`}
                  >
                    {action.label}
                  </button>
                </form>
              ))}
              {['validated', 'paid'].includes(decompte.statut) && (
                <p className="text-[11px] text-faint">
                  Décompte {badge.label.toLowerCase()} — le métré de sa période est verrouillé.
                </p>
              )}
            </div>
            <form
              action={patchDecompte}
              className="mt-4 flex items-end gap-2 border-t border-line pt-3"
            >
              <input type="hidden" name="projectId" value={id} />
              <input type="hidden" name="decompteId" value={decompteId} />
              <label className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-faint">
                Date du décompte
                <input
                  type="date"
                  name="dateDecompte"
                  defaultValue={decompte.dateDecompte?.slice(0, 10) ?? ''}
                  className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
                />
              </label>
              <button className="rounded-lg bg-sand px-3 py-2 text-xs font-bold text-ink-2 hover:bg-line">
                Dater
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
