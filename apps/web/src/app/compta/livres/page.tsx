// Livres & états — grand livre par compte, balance générale 6 colonnes,
// états de synthèse (CPC + bilan simplifiés) calculés depuis les écritures.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  type BalanceRow,
  type EtatsSynthese,
  type GrandLivreLigne,
} from '@/lib/compta';
import { AnneePicker, ComptaHeader, SectionCard, inputClass } from '../ui';

export const metadata = { title: 'Livres & états — Comptabilité ATLAS' };

const TABS = [
  { key: 'balance', label: 'Balance générale' },
  { key: 'grand-livre', label: 'Grand livre' },
  { key: 'etats', label: 'États de synthèse' },
] as const;

export default async function LivresPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; annee?: string; compte?: string }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const tab = params.compte ? 'grand-livre' : (params.tab ?? 'balance');

  const [balance, grandLivre, etats] = await Promise.all([
    tab === 'balance' || tab === 'etats'
      ? apiGet<BalanceRow[]>(`/compta/livres/balance?annee=${annee}`)
      : null,
    tab === 'grand-livre' && params.compte
      ? apiGet<GrandLivreLigne[]>(
          `/compta/livres/grand-livre?compte=${params.compte}&annee=${annee}`,
        )
      : null,
    tab === 'etats' ? apiGet<EtatsSynthese>(`/compta/livres/etats?annee=${annee}`) : null,
  ]);

  const totauxBalance = (balance ?? []).reduce(
    (acc, row) => ({
      debit: acc.debit + row.totalDebit,
      credit: acc.credit + row.totalCredit,
      sd: acc.sd + row.soldeDebiteur,
      sc: acc.sc + row.soldeCrediteur,
    }),
    { debit: 0, credit: 0, sd: 0, sc: 0 },
  );

  return (
    <div>
      <ComptaHeader
        title="Livres & états"
        subtitle="Balance, grand livre et états de synthèse — recalculés en direct depuis le journal."
        actions={<AnneePicker annee={annee} path="/compta/livres" />}
      />

      <nav className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/compta/livres?tab=${t.key}&annee=${annee}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? 'border-cyan text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'balance' && balance && (
        <SectionCard title={`Balance générale ${annee}`} subtitle="Comptes mouvementés uniquement.">
          {balance.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Aucun mouvement sur {annee} — saisissez des écritures.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Compte</th>
                    <th className="px-3 py-2 text-left">Intitulé</th>
                    <th className="px-3 py-2 text-right">Total débit</th>
                    <th className="px-3 py-2 text-right">Total crédit</th>
                    <th className="px-3 py-2 text-right">Solde débiteur</th>
                    <th className="px-3 py-2 text-right">Solde créditeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono text-xs tabular-nums">
                  {balance.map((row) => (
                    <tr key={row.compteCode} className="transition hover:bg-sand/40">
                      <td className="px-4 py-1.5 font-semibold text-cyan">
                        <Link
                          href={`/compta/livres?compte=${row.compteCode}&annee=${annee}`}
                          className="hover:underline"
                        >
                          {row.compteCode}
                        </Link>
                      </td>
                      <td className="max-w-70 truncate px-3 py-1.5 font-sans text-muted">
                        {row.intitule}
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmtMad(row.totalDebit)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMad(row.totalCredit)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">
                        {row.soldeDebiteur > 0 ? fmtMad(row.soldeDebiteur) : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold">
                        {row.soldeCrediteur > 0 ? fmtMad(row.soldeCrediteur) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-sand/70 font-mono text-xs font-bold tabular-nums">
                  <tr>
                    <td colSpan={2} className="px-4 py-2 font-sans uppercase">
                      Totaux
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMad(totauxBalance.debit)}</td>
                    <td className="px-3 py-2 text-right">{fmtMad(totauxBalance.credit)}</td>
                    <td className="px-3 py-2 text-right">{fmtMad(totauxBalance.sd)}</td>
                    <td className="px-3 py-2 text-right">{fmtMad(totauxBalance.sc)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'grand-livre' && (
        <SectionCard
          title={params.compte ? `Grand livre — compte ${params.compte}` : 'Grand livre'}
          subtitle="Mouvements chronologiques avec solde progressif."
          actions={
            <form className="flex gap-2">
              <input type="hidden" name="annee" value={annee} />
              <input
                name="compte"
                defaultValue={params.compte ?? ''}
                placeholder="Compte (ex. 3421)"
                className={`${inputClass} w-44 font-mono`}
              />
              <button className="rounded-lg bg-sand px-3 py-1.5 text-xs font-semibold text-ink-2">
                Afficher
              </button>
            </form>
          }
        >
          {!params.compte ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Saisissez un compte (ou un préfixe : 34, 61…) pour afficher ses mouvements.
            </p>
          ) : (grandLivre ?? []).length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Aucun mouvement pour {params.compte} sur {annee}.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Écriture</th>
                  <th className="px-3 py-2 text-left">Libellé</th>
                  <th className="px-3 py-2 text-right">Débit</th>
                  <th className="px-3 py-2 text-right">Crédit</th>
                  <th className="px-3 py-2 text-right">Solde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-xs tabular-nums">
                {(grandLivre ?? []).map((ligne, index) => (
                  <tr key={`${ligne.ecritureId}-${index}`} className="hover:bg-sand/40">
                    <td className="px-4 py-1.5">{fmtDate(ligne.dateEcriture)}</td>
                    <td className="px-3 py-1.5 text-cyan">
                      {ligne.journalCode}-{ligne.numero}
                    </td>
                    <td className="max-w-72 truncate px-3 py-1.5 font-sans text-ink-2">
                      {ligne.libelle}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ligne.debit > 0 ? fmtMad(ligne.debit) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ligne.credit > 0 ? fmtMad(ligne.credit) : ''}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-semibold ${
                        ligne.solde < 0 ? 'text-clay' : ''
                      }`}
                    >
                      {fmtMad(ligne.solde)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {tab === 'etats' && etats && (
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title={`CPC ${annee} — compte de produits et charges`}>
            <dl className="divide-y divide-line text-sm">
              {etats.cpc.postesProduits.map((poste) => (
                <div key={poste.label} className="flex justify-between px-5 py-2">
                  <dt className="text-muted">{poste.label}</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(poste.montant)}</dd>
                </div>
              ))}
              <div className="flex justify-between bg-sand/40 px-5 py-2 font-semibold">
                <dt>Produits d'exploitation</dt>
                <dd className="font-mono tabular-nums">{fmtMad(etats.cpc.produitsExploitation)}</dd>
              </div>
              {etats.cpc.postesCharges.map((poste) => (
                <div key={poste.label} className="flex justify-between px-5 py-2">
                  <dt className="text-muted">{poste.label}</dt>
                  <dd className="font-mono tabular-nums">− {fmtMad(poste.montant)}</dd>
                </div>
              ))}
              <div className="flex justify-between bg-sand/40 px-5 py-2 font-semibold">
                <dt>Résultat d'exploitation</dt>
                <dd className="font-mono tabular-nums">{fmtMad(etats.cpc.resultatExploitation)}</dd>
              </div>
              <div className="flex justify-between px-5 py-2">
                <dt className="text-muted">Résultat financier</dt>
                <dd className="font-mono tabular-nums">{fmtMad(etats.cpc.resultatFinancier)}</dd>
              </div>
              <div className="flex justify-between px-5 py-2">
                <dt className="text-muted">Résultat non courant</dt>
                <dd className="font-mono tabular-nums">{fmtMad(etats.cpc.resultatNonCourant)}</dd>
              </div>
              <div className="flex justify-between px-5 py-2">
                <dt className="text-muted">Impôts sur les résultats</dt>
                <dd className="font-mono tabular-nums">− {fmtMad(etats.cpc.impotsResultats)}</dd>
              </div>
              <div
                className={`flex justify-between px-5 py-3 text-base font-bold ${
                  etats.cpc.resultatNet >= 0 ? 'text-emerald' : 'text-clay'
                }`}
              >
                <dt>Résultat net</dt>
                <dd className="font-mono tabular-nums">{fmtMad(etats.cpc.resultatNet)}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title={`Bilan ${annee} (simplifié)`}>
            <div className="grid grid-cols-2 divide-x divide-line text-sm">
              <dl className="divide-y divide-line">
                <div className="bg-sand/40 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                  Actif
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Actif immobilisé</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.actifImmobilise)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Actif circulant</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.actifCirculant)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Trésorerie actif</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.tresorerieActif)}</dd>
                </div>
                <div className="flex justify-between px-4 py-3 font-bold">
                  <dt>Total actif</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.totalActif)}</dd>
                </div>
              </dl>
              <dl className="divide-y divide-line">
                <div className="bg-sand/40 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                  Passif
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Financement permanent</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtMad(etats.bilan.financementPermanent)}
                  </dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Passif circulant</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.passifCirculant)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted">Trésorerie passif + résultat</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtMad(etats.bilan.tresoreriePassif + etats.bilan.resultatPeriode)}
                  </dd>
                </div>
                <div className="flex justify-between px-4 py-3 font-bold">
                  <dt>Total passif</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(etats.bilan.totalPassif)}</dd>
                </div>
              </dl>
            </div>
            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
              Modèle simplifié de pilotage — la liasse officielle reste établie par votre
              comptable.
            </p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
