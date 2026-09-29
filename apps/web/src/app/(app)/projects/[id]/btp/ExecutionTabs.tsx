// Onglets d'exécution: Bordereau (éditeur), Métrés (périodes), Décomptes
// (générés par le moteur) et Export Excel.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  DECOMPTE_STATUS_BADGES,
  fmtDate,
  fmtMadPrecise,
  type Bordereau,
  type BtpProjectDetail,
  type Decompte,
  type Periode,
} from '@/lib/btp';
import { createPeriode, deletePeriode, patchPeriode, saveBordereau } from '../actions';
import { BordereauEditor } from './BordereauEditor';

// ─── Bordereau ───────────────────────────────────────────────────────────────

export async function BordereauTab({ project }: { project: BtpProjectDetail }) {
  const bordereau = await apiGet<Bordereau>(`/btp/projects/${project.id}/bordereau`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Bordereau des prix (BPU)</h2>
          <p className="text-xs text-muted">
            Chaque ligne alimente le métré ; l'enregistrement recalcule le montant du marché et
            reconstruit les décomptes.
          </p>
        </div>
        <a
          href={`/api/btp-export/${project.id}/bordereau`}
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-emerald hover:text-emerald"
        >
          ⬇ Export Excel
        </a>
      </div>
      <BordereauEditor
        projectId={project.id}
        initialLignes={bordereau?.lignes ?? []}
        action={saveBordereau}
      />
    </div>
  );
}

// ─── Métrés (périodes) ───────────────────────────────────────────────────────

export async function MetresTab({ project }: { project: BtpProjectDetail }) {
  const periodes = await apiGet<Periode[]>(`/btp/projects/${project.id}/periodes`);
  const hasBordereau = project.counts.bordereauLignes > 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Métrés par période</h2>
          <p className="text-xs text-muted">
            « Nouveau métré » crée la période et son décompte (vide) — saisissez ensuite les
            mesures : le décompte se génère tout seul.
          </p>
        </div>
        {hasBordereau ? (
          <form action={createPeriode} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Du
              <input
                type="date"
                name="dateDebut"
                className="mt-1 block rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Au
              <input
                type="date"
                name="dateFin"
                className="mt-1 block rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-1.5 text-xs font-semibold text-muted">
              <input type="checkbox" name="isDecompteDernier" className="accent-cyan" />
              Décompte et dernier
            </label>
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Nouveau métré
            </button>
          </form>
        ) : (
          <Link
            href={`/projects/${project.id}?tab=bordereau`}
            className="rounded-lg border border-ochre-soft bg-ochre-soft/20 px-3 py-2 text-xs font-semibold text-ochre"
          >
            Saisissez d'abord le bordereau →
          </Link>
        )}
      </div>

      {periodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-muted">Aucun métré pour l'instant.</p>
          <p className="mt-1 text-xs text-faint">
            Créez la première période — le décompte n°1 naîtra avec elle.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {periodes.map((periode) => (
            <div
              key={periode.id}
              className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm transition hover:border-cyan"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/projects/${project.id}/metres/${periode.id}`}
                  className="font-mono text-sm font-bold text-cyan hover:underline"
                >
                  Métré n°{periode.numero}
                </Link>
                {periode.isDecompteDernier && (
                  <span className="rounded-full bg-emerald-soft px-2 py-0.5 text-[10px] font-bold text-emerald">
                    et dernier
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {periode.libelle ?? `Période ${periode.numero}`}
              </p>
              <dl className="mt-3 space-y-1 text-xs text-muted">
                <div className="flex justify-between">
                  <dt className="text-faint">Période</dt>
                  <dd className="font-mono">
                    {fmtDate(periode.dateDebut)} → {fmtDate(periode.dateFin)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-faint">Articles mesurés</dt>
                  <dd className="font-mono">{periode.metresCount ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-faint">TVA · Retenue</dt>
                  <dd className="font-mono">
                    {periode.tauxTva}% · {periode.tauxRetenue}%
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex items-center justify-between gap-2">
                <Link
                  href={`/projects/${project.id}/metres/${periode.id}`}
                  className="rounded-lg bg-cyan-soft px-3 py-1.5 text-xs font-bold text-cyan transition hover:bg-cyan hover:text-paper"
                >
                  Ouvrir le métré →
                </Link>
                <div className="flex items-center gap-2">
                  <form action={patchPeriode}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="periodeId" value={periode.id} />
                    <input type="hidden" name="isDecompteDernierFlag" value="1" />
                    {!periode.isDecompteDernier && (
                      <input type="hidden" name="isDecompteDernier" value="on" />
                    )}
                    <button
                      className="text-[11px] font-semibold text-faint hover:text-emerald"
                      title="Basculer « décompte et dernier »"
                    >
                      {periode.isDecompteDernier ? 'Retirer « dernier »' : 'Marquer dernier'}
                    </button>
                  </form>
                  <form action={deletePeriode}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="periodeId" value={periode.id} />
                    <button className="text-[11px] font-semibold text-faint hover:text-clay">
                      Supprimer
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Décomptes ───────────────────────────────────────────────────────────────

export async function DecomptesTab({ project }: { project: BtpProjectDetail }) {
  const decomptes = await apiGet<Decompte[]>(`/btp/projects/${project.id}/decomptes`);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Décomptes provisoires</h2>
        <p className="text-xs text-muted">
          Générés automatiquement à chaque enregistrement de métré — quantités cumulées, retenue de
          garantie, révision sur le dernier.
        </p>
      </div>
      {decomptes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-muted">Aucun décompte.</p>
          <p className="mt-1 text-xs text-faint">Créez un métré : son décompte suivra.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">N°</th>
                <th className="px-4 py-3">Période</th>
                <th className="px-4 py-3 text-right">HT cumulé</th>
                <th className="px-4 py-3 text-right">TTC cumulé</th>
                <th className="px-4 py-3 text-right">Retenue</th>
                <th className="px-4 py-3 text-right">Montant de l'acompte</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {decomptes.map((decompte) => {
                const badge = DECOMPTE_STATUS_BADGES[decompte.statut] ?? {
                  label: decompte.statut,
                  classes: 'bg-sand text-muted',
                };
                return (
                  <tr key={decompte.id} className="transition hover:bg-sand/40">
                    <td className="px-4 py-3 font-mono font-bold text-cyan">
                      {decompte.numero}
                      {decompte.isDernier && (
                        <span className="ml-1.5 rounded-full bg-emerald-soft px-1.5 py-0.5 text-[10px] font-bold text-emerald">
                          dernier
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {decompte.periodeLibelle ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {fmtMadPrecise(decompte.totalHtMad)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {fmtMadPrecise(decompte.totalTtcMad)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ochre">
                      {fmtMadPrecise(decompte.retenueGarantieMad)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-emerald">
                      {fmtMadPrecise(decompte.montantAcompteMad)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/projects/${project.id}/decomptes/${decompte.id}`}
                        className="text-xs font-bold text-cyan hover:underline"
                      >
                        Détail →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function ExportTab({ project }: { project: BtpProjectDetail }) {
  const decomptes = await apiGet<Decompte[]>(`/btp/projects/${project.id}/decomptes`);
  const cards: { title: string; description: string; href: string }[] = [
    {
      title: 'Bordereau des prix',
      description: 'Lignes + formules Excel vivantes (=D×E, SUM).',
      href: `/api/btp-export/${project.id}/bordereau`,
    },
    {
      title: 'Attachement (dernière période)',
      description: 'Certification des quantités — sans prix.',
      href: `/api/btp-export/${project.id}/attachement`,
    },
    {
      title: 'Récapitulatif des décomptes',
      description: 'HT/TVA/TTC, retenue et acompte, décompte par décompte.',
      href: `/api/btp-export/${project.id}/recapitulatif`,
    },
    ...decomptes.map((decompte) => ({
      title: `Décompte n°${decompte.numero}${decompte.isDernier ? ' et dernier' : ''}`,
      description: `TTC cumulé ${fmtMadPrecise(decompte.totalTtcMad)} — acompte ${fmtMadPrecise(decompte.montantAcompteMad)}.`,
      href: `/api/btp-export/${project.id}/decompte?decompteId=${decompte.id}`,
    })),
  ];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Export Excel</h2>
        <p className="text-xs text-muted">
          Les fichiers embarquent des formules vivantes — modifiables dans Excel sans casser les
          totaux.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm transition hover:border-emerald"
          >
            <p className="text-sm font-bold text-ink-2">⬇ {card.title}</p>
            <p className="mt-1 text-xs text-muted">{card.description}</p>
          </a>
        ))}
      </div>
      <p className="text-[11px] text-faint">
        Astuce : l'attachement d'une période précise s'exporte depuis l'éditeur de métré.
      </p>
    </div>
  );
}
