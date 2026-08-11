// Tableau de bord Comptabilité — situation fiscale, sociale et légale de
// l'entreprise d'un seul regard : échéances classées par urgence, indicateurs
// de l'exercice, TVA courante, complétude de la fiche légale et veille
// réglementaire (LF 2026).
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  SOURCE_ECHEANCE_LABELS,
  URGENCE_BADGES,
  fmtDate,
  fmtMad,
  fmtMadCompact,
  type ComptaDashboard,
} from '@/lib/compta';
import { initialiserAnnee } from './actions';
import { ComptaHeader, KpiCard, StatusBanners, StatutBadge, btnGhost } from './ui';

export const metadata = { title: 'Comptabilité — ATLAS' };

export default async function ComptaDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; code?: string }>;
}) {
  const params = await searchParams;
  const dashboard = await apiGet<ComptaDashboard>('/compta/dashboard');
  const annee = new Date().getFullYear();
  const aucuneEcheance = dashboard.compteurs.total === 0;

  return (
    <div>
      <ComptaHeader
        title="Situation de l'entreprise"
        subtitle={`${dashboard.profil.raisonSociale} · ${dashboard.profil.formeJuridique} — exercice ${annee}, régime TVA ${dashboard.profil.regimeTva}.`}
        actions={
          <>
            <Link href="/compta/ecritures" className={btnGhost}>
              Saisir une écriture
            </Link>
            <Link href="/compta/legal" className={btnGhost}>
              Statut légal
            </Link>
          </>
        }
      />
      <StatusBanners searchParams={params} />

      {/* Alerte fiche légale incomplète */}
      {dashboard.ficheLegaleManquants.length > 0 && (
        <div className="mb-5 rounded-lg border border-ochre-soft bg-ochre-soft/20 px-4 py-2.5 text-sm text-ochre">
          <span className="font-semibold">Fiche légale incomplète :</span>{' '}
          {dashboard.ficheLegaleManquants.join(' · ')} —{' '}
          <Link href="/compta/parametres" className="font-semibold underline">
            compléter
          </Link>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Échéances en retard"
          value={dashboard.compteurs.enRetard}
          accent={dashboard.compteurs.enRetard > 0 ? 'border-l-clay' : 'border-l-emerald'}
          hint="fiscal + social + légal"
        />
        <KpiCard
          label="À traiter sous 30 j"
          value={dashboard.compteurs.sous30Jours}
          accent="border-l-ochre"
        />
        <KpiCard
          label="Chiffre d'affaires (écritures)"
          value={fmtMadCompact(dashboard.chiffreAffaires)}
          accent="border-l-cyan"
          hint={`exercice ${annee}`}
        />
        <KpiCard
          label="Résultat provisoire"
          value={fmtMadCompact(dashboard.resultatProvisoire)}
          accent={dashboard.resultatProvisoire >= 0 ? 'border-l-emerald' : 'border-l-clay'}
        />
        <KpiCard
          label="Trésorerie (comptes 51/55)"
          value={fmtMadCompact(dashboard.tresorerie)}
          accent="border-l-teal"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Échéancier */}
        <section className="xl:col-span-2 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <header className="flex items-center justify-between border-b border-line bg-sand/50 px-5 py-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-ink-2">
              Prochaines échéances
            </h2>
            <Link href="/compta/impots" className="text-xs font-semibold text-cyan hover:underline">
              Échéancier complet →
            </Link>
          </header>
          {aucuneEcheance ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-semibold text-muted">
                Aucune échéance générée pour l'instant.
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-faint">
                Générez l'échéancier fiscal, social et légal de l'année (acomptes IS, TVA, CNSS,
                liasse, AG…) — les lignes restent ajustables.
              </p>
              <form action={initialiserAnnee} className="mt-4">
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value="/compta" />
                <button className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper hover:opacity-90">
                  ⚡ Générer l'échéancier {annee}
                </button>
              </form>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {dashboard.echeances.slice(0, 14).map((echeance) => {
                const badge = URGENCE_BADGES[echeance.urgence];
                return (
                  <li
                    key={`${echeance.source}-${echeance.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-sand/40"
                  >
                    <span
                      className={`inline-flex w-20 shrink-0 justify-center rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="w-16 shrink-0 rounded bg-sand px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-muted">
                      {SOURCE_ECHEANCE_LABELS[echeance.source]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {echeance.label}
                    </span>
                    {echeance.montant !== null && echeance.montant > 0 && (
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {fmtMad(echeance.montant)}
                      </span>
                    )}
                    <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-ink-2">
                      {fmtDate(echeance.dateEcheance)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* TVA courante */}
          <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
            <header className="border-b border-line bg-sand/50 px-5 py-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-ink-2">
                TVA — période courante
              </h2>
            </header>
            {dashboard.tvaCourante ? (
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-ink">
                    {dashboard.tvaCourante.periodeKey}
                  </span>
                  <StatutBadge statut={dashboard.tvaCourante.statut} />
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">TVA due</dt>
                    <dd className="font-mono font-semibold tabular-nums text-ink">
                      {fmtMad(dashboard.tvaCourante.tvaDue)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Échéance</dt>
                    <dd className="font-mono tabular-nums">
                      {fmtDate(dashboard.tvaCourante.dateEcheance)}
                    </dd>
                  </div>
                </dl>
                <Link
                  href="/compta/tva"
                  className="mt-3 inline-block text-xs font-semibold text-cyan hover:underline"
                >
                  Préparer la déclaration →
                </Link>
              </div>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">
                Aucune période TVA —{' '}
                <Link href="/compta/tva" className="font-semibold text-cyan hover:underline">
                  générer l'année
                </Link>
                .
              </p>
            )}
          </section>

          {/* Veille réglementaire */}
          <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
            <header className="border-b border-line bg-sand/50 px-5 py-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-ink-2">
                Veille réglementaire — à surveiller
              </h2>
            </header>
            <ul className="divide-y divide-line">
              {dashboard.veille.map((item) => (
                <li key={item.titre} className="px-5 py-3">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        item.impact === 'important' ? 'bg-clay' : 'bg-ochre'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-ink">{item.titre}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.detail}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
