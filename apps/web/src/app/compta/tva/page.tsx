// TVA — périodes SIMPL de l'année : montants (pré-remplissables depuis les
// écritures 4455/34551/34552), TVA due / crédit reporté, circuit de statut.
import { apiGet } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  periodeLabel,
  type ComptaProfil,
  type TvaDeclaration,
} from '@/lib/compta';
import { calculerTva, genererEcheancier, patchTva } from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  KpiCard,
  SectionCard,
  StatusBanners,
  StatutBadge,
  btnGhost,
  inputClass,
} from '../ui';

export const metadata = { title: 'TVA — Comptabilité ATLAS' };

export default async function TvaPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    annee?: string;
    periode?: string;
  }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const [declarations, profil] = await Promise.all([
    apiGet<TvaDeclaration[]>(`/compta/tva?annee=${annee}`),
    apiGet<ComptaProfil>('/compta/profil'),
  ]);
  const ouverte =
    declarations.find((d) => d.id === params.periode) ??
    declarations.find((d) => d.statut === 'a_preparer' || d.statut === 'a_declarer') ??
    declarations[declarations.length - 1];

  const totalDue = declarations.reduce((s, d) => s + d.tvaDue, 0);
  const payees = declarations.filter((d) => d.statut === 'payee').length;

  return (
    <div>
      <ComptaHeader
        title="TVA"
        subtitle={`Régime ${profil.regimeTva} — télédéclaration et télépaiement SIMPL-TVA avant la fin du mois suivant la période. Travaux BTP au taux normal 20 %.`}
        actions={<AnneePicker annee={annee} path="/compta/tva" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Périodes" value={declarations.length} accent="border-l-cyan" />
        <KpiCard
          label="Déclarées & payées"
          value={`${payees}/${declarations.length}`}
          accent="border-l-emerald"
        />
        <KpiCard label={`TVA due ${annee}`} value={fmtMad(totalDue)} accent="border-l-ochre" />
        <KpiCard
          label="Crédit reporté (dernière)"
          value={fmtMad(declarations[declarations.length - 1]?.creditNouveau ?? 0)}
          accent="border-l-teal"
        />
      </div>

      {declarations.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-paper-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-muted">Aucune période TVA pour {annee}.</p>
          <form action={genererEcheancier} className="mt-4">
            <input type="hidden" name="annee" value={annee} />
            <input type="hidden" name="backTo" value={`/compta/tva?annee=${annee}`} />
            <button className="rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
              ⚡ Générer les périodes {annee}
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SectionCard title={`Périodes ${annee}`}>
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Période</th>
                    <th className="px-3 py-2 text-left">Échéance</th>
                    <th className="px-3 py-2 text-right">TVA due</th>
                    <th className="px-3 py-2 text-right">Crédit</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {declarations.map((d) => (
                    <tr
                      key={d.id}
                      className={`transition hover:bg-sand/40 ${
                        ouverte?.id === d.id ? 'bg-cyan-soft/20' : ''
                      }`}
                    >
                      <td className="px-4 py-2">
                        <a
                          href={`/compta/tva?annee=${annee}&periode=${d.id}`}
                          className="font-semibold text-ink hover:text-cyan"
                        >
                          {periodeLabel(d.periodeKey)}
                        </a>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {fmtDate(d.dateEcheance)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {fmtMad(d.tvaDue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">
                        {d.creditNouveau > 0 ? fmtMad(d.creditNouveau) : ''}
                      </td>
                      <td className="px-3 py-2">
                        <StatutBadge statut={d.statut} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </div>

          {ouverte && (
            <div className="xl:col-span-2">
              <SectionCard
                title={`Déclaration ${periodeLabel(ouverte.periodeKey)}`}
                subtitle={`Échéance ${fmtDate(ouverte.dateEcheance)}`}
                actions={
                  <form action={calculerTva}>
                    <input type="hidden" name="id" value={ouverte.id} />
                    <input
                      type="hidden"
                      name="backTo"
                      value={`/compta/tva?annee=${annee}&periode=${ouverte.id}`}
                    />
                    <button className={btnGhost} title="Pré-remplit depuis les écritures">
                      ⚡ Calculer depuis les écritures
                    </button>
                  </form>
                }
              >
                <form action={patchTva} className="space-y-3 px-5 py-4">
                  <input type="hidden" name="id" value={ouverte.id} />
                  <input
                    type="hidden"
                    name="backTo"
                    value={`/compta/tva?annee=${annee}&periode=${ouverte.id}`}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ['tvaCollectee', 'TVA collectée (4455)', ouverte.tvaCollectee],
                        [
                          'tvaDeductibleCharges',
                          'Déductible charges (34552)',
                          ouverte.tvaDeductibleCharges,
                        ],
                        ['tvaDeductibleImmo', 'Déductible immo (34551)', ouverte.tvaDeductibleImmo],
                        ['creditAnterieur', 'Crédit antérieur', ouverte.creditAnterieur],
                      ] as const
                    ).map(([name, label, value]) => (
                      <label
                        key={name}
                        className="flex flex-col gap-1 text-xs font-semibold text-muted"
                      >
                        {label}
                        <input
                          name={name}
                          inputMode="decimal"
                          defaultValue={value || ''}
                          className={`${inputClass} text-right font-mono tabular-nums`}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-sand/60 px-4 py-2.5">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">
                      TVA due
                    </span>
                    <span className="font-mono text-lg font-bold tabular-nums text-ink">
                      {fmtMad(ouverte.tvaDue)}
                    </span>
                  </div>
                  {ouverte.creditNouveau > 0 && (
                    <p className="text-xs text-teal">
                      Crédit reporté : <b className="font-mono">{fmtMad(ouverte.creditNouveau)}</b>
                    </p>
                  )}
                  <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
                    Enregistrer les montants
                  </button>
                </form>

                <div className="border-t border-line px-5 py-4">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                    Circuit de déclaration
                  </p>
                  <form action={patchTva} className="space-y-2.5">
                    <input type="hidden" name="id" value={ouverte.id} />
                    <input type="hidden" name="_dates" value="1" />
                    <input
                      type="hidden"
                      name="backTo"
                      value={`/compta/tva?annee=${annee}&periode=${ouverte.id}`}
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                        Statut
                        <select name="statut" defaultValue={ouverte.statut} className={inputClass}>
                          <option value="a_preparer">À préparer</option>
                          <option value="a_declarer">À déclarer</option>
                          <option value="declaree">Déclarée</option>
                          <option value="payee">Payée</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                        Référence SIMPL
                        <input
                          name="reference"
                          defaultValue={ouverte.reference ?? ''}
                          className={`${inputClass} font-mono`}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                        Date déclaration
                        <input
                          type="date"
                          name="dateDeclaration"
                          defaultValue={ouverte.dateDeclaration?.slice(0, 10) ?? ''}
                          className={`${inputClass} font-mono`}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                        Date paiement
                        <input
                          type="date"
                          name="datePaiement"
                          defaultValue={ouverte.datePaiement?.slice(0, 10) ?? ''}
                          className={`${inputClass} font-mono`}
                        />
                      </label>
                    </div>
                    <button className="w-full rounded-lg border border-cyan px-4 py-2 text-sm font-bold text-cyan hover:bg-cyan-soft/30">
                      Mettre à jour le statut
                    </button>
                  </form>
                </div>
              </SectionCard>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
