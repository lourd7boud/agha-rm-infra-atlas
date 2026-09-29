// Banques — comptes bancaires avec solde consolidé, mouvements (encaissements
// / décaissements) et pointage de rapprochement avec le relevé.
import { apiGet } from '@/lib/api';
import { fmtDate, fmtMad, type BanqueCompte, type BanqueMouvement } from '@/lib/compta';
import { createBanque, createMouvement, deleteMouvement, toggleRapproche } from '../actions';
import { ComptaHeader, KpiCard, SectionCard, StatusBanners, inputClass } from '../ui';

export const metadata = { title: 'Banques — Comptabilité ATLAS' };

export default async function BanquesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; code?: string; compte?: string }>;
}) {
  const params = await searchParams;
  const comptes = await apiGet<BanqueCompte[]>('/compta/banques');
  const selection = comptes.find((c) => c.id === params.compte) ?? comptes[0];
  const mouvements = selection
    ? await apiGet<BanqueMouvement[]>(`/compta/banques/${selection.id}/mouvements?limit=200`)
    : [];

  const soldeTotal = comptes.reduce((s, c) => s + c.solde, 0);
  const nonRapproches = comptes.reduce((s, c) => s + c.mouvementsNonRapproches, 0);

  return (
    <div>
      <ComptaHeader
        title="Banques & rapprochement"
        subtitle="Suivi des comptes bancaires de la société — soldes consolidés, mouvements pointés contre les relevés."
      />
      <StatusBanners searchParams={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Comptes" value={comptes.length} accent="border-l-cyan" />
        <KpiCard
          label="Solde consolidé"
          value={fmtMad(soldeTotal)}
          accent={soldeTotal >= 0 ? 'border-l-emerald' : 'border-l-clay'}
        />
        <KpiCard label="Mouvements à pointer" value={nonRapproches} accent="border-l-ochre" />
        <KpiCard
          label="Compte affiché"
          value={selection ? selection.banque : '—'}
          accent="border-l-teal"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <SectionCard title="Comptes bancaires">
            {comptes.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Aucun compte.</p>
            ) : (
              <ul className="divide-y divide-line">
                {comptes.map((compte) => (
                  <li key={compte.id}>
                    <a
                      href={`/compta/banques?compte=${compte.id}`}
                      className={`flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-sand/40 ${
                        selection?.id === compte.id ? 'bg-cyan-soft/20' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{compte.banque}</p>
                        <p className="truncate font-mono text-[10px] text-faint">
                          {compte.rib ?? compte.agence ?? ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-mono text-sm font-bold tabular-nums ${
                            compte.solde < 0 ? 'text-clay' : 'text-ink'
                          }`}
                        >
                          {fmtMad(compte.solde)}
                        </p>
                        {compte.mouvementsNonRapproches > 0 && (
                          <p className="text-[10px] text-ochre">
                            {compte.mouvementsNonRapproches} à pointer
                          </p>
                        )}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Ajouter un compte">
            <form action={createBanque} className="space-y-2.5 px-5 py-4">
              <input
                name="banque"
                required
                placeholder="Banque (ex. Crédit Agricole)"
                className={`${inputClass} w-full`}
              />
              <input name="agence" placeholder="Agence" className={`${inputClass} w-full`} />
              <input name="rib" placeholder="RIB" className={`${inputClass} w-full font-mono`} />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  name="soldeInitial"
                  inputMode="decimal"
                  placeholder="Solde initial"
                  className={`${inputClass} text-right font-mono`}
                />
                <input type="date" name="dateSoldeInitial" className={`${inputClass} font-mono`} />
              </div>
              <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
                Créer
              </button>
            </form>
          </SectionCard>
        </div>

        <div className="xl:col-span-2">
          {selection && (
            <SectionCard
              title={`Mouvements — ${selection.banque}`}
              subtitle={`Solde initial ${fmtMad(selection.soldeInitial)}${
                selection.dateSoldeInitial ? ` au ${fmtDate(selection.dateSoldeInitial)}` : ''
              }`}
            >
              <form
                action={createMouvement}
                className="grid grid-cols-2 gap-2 border-b border-line bg-paper px-4 py-3 sm:grid-cols-6"
              >
                <input type="hidden" name="compteId" value={selection.id} />
                <input
                  type="hidden"
                  name="backTo"
                  value={`/compta/banques?compte=${selection.id}`}
                />
                <input
                  type="date"
                  name="dateMouvement"
                  required
                  className={`${inputClass} font-mono`}
                />
                <input
                  name="libelle"
                  required
                  placeholder="Libellé"
                  className={`${inputClass} sm:col-span-2`}
                />
                <select name="sens" className={inputClass}>
                  <option value="credit">Encaissement +</option>
                  <option value="debit">Décaissement −</option>
                </select>
                <input
                  name="montant"
                  required
                  inputMode="decimal"
                  placeholder="Montant"
                  className={`${inputClass} text-right font-mono`}
                />
                <button className="rounded-lg bg-cyan px-3 py-2 text-sm font-bold text-paper">
                  Ajouter
                </button>
              </form>
              {mouvements.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">Aucun mouvement.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Libellé</th>
                      <th className="px-3 py-2 text-right">Montant</th>
                      <th className="px-3 py-2 text-center">Rapproché</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {mouvements.map((m) => (
                      <tr key={m.id} className="transition hover:bg-sand/40">
                        <td className="px-4 py-2 font-mono text-xs tabular-nums">
                          {fmtDate(m.dateMouvement)}
                        </td>
                        <td className="max-w-72 truncate px-3 py-2" title={m.libelle}>
                          {m.libelle}
                          {m.reference && (
                            <span className="ml-1.5 font-mono text-[10px] text-faint">
                              {m.reference}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums ${
                            m.montant < 0 ? 'text-clay' : 'text-emerald'
                          }`}
                        >
                          {m.montant > 0 ? '+' : ''}
                          {fmtMad(m.montant)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <form action={toggleRapproche}>
                            <input type="hidden" name="id" value={m.id} />
                            <input
                              type="hidden"
                              name="backTo"
                              value={`/compta/banques?compte=${selection.id}`}
                            />
                            <button
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                m.rapproche
                                  ? 'bg-emerald-soft/50 text-emerald'
                                  : 'bg-sand text-muted hover:bg-line'
                              }`}
                              title="Basculer le pointage"
                            >
                              {m.rapproche ? '✓ Pointé' : 'À pointer'}
                            </button>
                          </form>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <form action={deleteMouvement}>
                            <input type="hidden" name="id" value={m.id} />
                            <input
                              type="hidden"
                              name="backTo"
                              value={`/compta/banques?compte=${selection.id}`}
                            />
                            <button className="text-faint hover:text-clay" aria-label="Supprimer">
                              ✕
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
