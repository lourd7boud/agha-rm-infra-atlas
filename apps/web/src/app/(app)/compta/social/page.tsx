// CNSS & paie — déclarations mensuelles DAMANCOM (cotisations calculées aux
// taux 2026), échéance le 10 du mois suivant, estimateur IR salaire.
import { apiGet } from '@/lib/api';
import { fmtDate, fmtMad, periodeLabel, type SocialDeclaration } from '@/lib/compta';
import { genererEcheancier, patchSocial } from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  KpiCard,
  SectionCard,
  StatusBanners,
  StatutBadge,
  inputClass,
} from '../ui';

export const metadata = { title: 'CNSS & paie — Comptabilité ATLAS' };

const RUBRIQUES: Record<string, string> = {
  allocationsFamiliales: 'Allocations familiales (6,40 %)',
  prestationsCourtTerme: 'Prestations court terme (1,05 / 0,52 %)',
  prestationsLongTerme: 'Prestations long terme (7,93 / 3,96 %)',
  amo: 'AMO (2,26 / 2,26 %)',
  participationAmo: 'Participation AMO (1,85 %)',
  formationProfessionnelle: 'Formation professionnelle (1,60 %)',
};

interface SimulIr {
  rni: number;
  ir: number;
  cotisationsSalariales: number;
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    annee?: string;
    periode?: string;
    brut?: string;
    personnes?: string;
  }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const [declarations, simulation] = await Promise.all([
    apiGet<SocialDeclaration[]>(`/compta/social?annee=${annee}`),
    params.brut
      ? apiGet<SimulIr>(
          `/compta/outils/ir?brut=${Number(params.brut) || 0}&personnes=${
            Number(params.personnes) || 0
          }`,
        )
      : null,
  ]);
  const ouverte =
    declarations.find((d) => d.id === params.periode) ??
    declarations.find((d) => d.statut === 'a_preparer') ??
    declarations[declarations.length - 1];
  const totalCotisations = declarations.reduce((s, d) => s + d.totalCotisations, 0);
  const dernierAvecMasse = [...declarations].reverse().find((d) => d.masseSalariale > 0);

  return (
    <div>
      <ComptaHeader
        title="CNSS & paie"
        subtitle="DAMANCOM : déclaration nominative ET paiement avant le 10 du mois suivant — majorations dès le 11 (3 % puis 0,5 %/mois). Taux 2026 appliqués automatiquement."
        actions={<AnneePicker annee={annee} path="/compta/social" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Mois traités"
          value={`${declarations.filter((d) => d.statut !== 'a_preparer').length}/${declarations.length}`}
          accent="border-l-cyan"
        />
        <KpiCard
          label={`Cotisations ${annee}`}
          value={fmtMad(totalCotisations)}
          accent="border-l-ochre"
        />
        <KpiCard
          label="Masse salariale (dernier mois saisi)"
          value={fmtMad(dernierAvecMasse?.masseSalariale ?? 0)}
          accent="border-l-teal"
        />
        <KpiCard
          label="Effectif"
          value={dernierAvecMasse?.effectif ?? '—'}
          accent="border-l-emerald"
        />
      </div>

      {declarations.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-paper-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-muted">Aucun mois généré pour {annee}.</p>
          <form action={genererEcheancier} className="mt-4">
            <input type="hidden" name="annee" value={annee} />
            <input type="hidden" name="backTo" value={`/compta/social?annee=${annee}`} />
            <button className="rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
              ⚡ Générer les 12 mois {annee}
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SectionCard title={`Déclarations ${annee}`}>
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Mois</th>
                    <th className="px-3 py-2 text-left">Échéance</th>
                    <th className="px-3 py-2 text-right">Masse</th>
                    <th className="px-3 py-2 text-right">Cotisations</th>
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
                          href={`/compta/social?annee=${annee}&periode=${d.id}`}
                          className="font-semibold hover:text-cyan"
                        >
                          {periodeLabel(d.periodeKey)}
                        </a>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {fmtDate(d.dateEcheance)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {d.masseSalariale > 0 ? fmtMad(d.masseSalariale) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {d.totalCotisations > 0 ? fmtMad(d.totalCotisations) : '—'}
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

          <div className="space-y-6 xl:col-span-2">
            {ouverte && (
              <SectionCard
                title={`CNSS ${periodeLabel(ouverte.periodeKey)}`}
                subtitle={`Échéance DAMANCOM : ${fmtDate(ouverte.dateEcheance)}`}
              >
                <form action={patchSocial} className="space-y-3 px-5 py-4">
                  <input type="hidden" name="id" value={ouverte.id} />
                  <input type="hidden" name="_dates" value="1" />
                  <input
                    type="hidden"
                    name="backTo"
                    value={`/compta/social?annee=${annee}&periode=${ouverte.id}`}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                      Masse salariale brute
                      <input
                        name="masseSalariale"
                        inputMode="decimal"
                        defaultValue={ouverte.masseSalariale || ''}
                        className={`${inputClass} text-right font-mono`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                      Effectif
                      <input
                        name="effectif"
                        inputMode="numeric"
                        defaultValue={ouverte.effectif || ''}
                        className={`${inputClass} text-right font-mono`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                      Statut
                      <select name="statut" defaultValue={ouverte.statut} className={inputClass}>
                        <option value="a_preparer">À préparer</option>
                        <option value="declaree">Déclarée</option>
                        <option value="payee">Payée</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                      Réf. DAMANCOM
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
                  <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
                    Calculer les cotisations & enregistrer
                  </button>
                </form>
                {ouverte.totalCotisations > 0 && (
                  <dl className="space-y-1 border-t border-line px-5 py-4 text-xs">
                    {Object.entries(ouverte.detail).map(([rubrique, parts]) => (
                      <div key={rubrique} className="flex justify-between">
                        <dt className="text-muted">{RUBRIQUES[rubrique] ?? rubrique}</dt>
                        <dd className="font-mono tabular-nums">
                          {fmtMad(parts.patronal + parts.salarial)}
                        </dd>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-line pt-2 text-sm font-bold">
                      <dt>
                        Total (patronal {fmtMad(ouverte.partPatronale)} + salarial{' '}
                        {fmtMad(ouverte.partSalariale)})
                      </dt>
                      <dd className="font-mono tabular-nums">{fmtMad(ouverte.totalCotisations)}</dd>
                    </div>
                  </dl>
                )}
              </SectionCard>
            )}

            <SectionCard
              title="Estimateur IR salaire (barème 2026)"
              subtitle="Brut → CNSS salariales, frais pro, IR net."
            >
              <form className="grid grid-cols-3 gap-2.5 px-5 py-4">
                <input type="hidden" name="annee" value={annee} />
                <input
                  name="brut"
                  inputMode="decimal"
                  defaultValue={params.brut ?? ''}
                  placeholder="Brut mensuel"
                  className={`${inputClass} col-span-2 text-right font-mono`}
                />
                <input
                  name="personnes"
                  inputMode="numeric"
                  defaultValue={params.personnes ?? ''}
                  placeholder="Pers. à charge"
                  className={`${inputClass} text-right font-mono`}
                />
                <button className="col-span-3 rounded-lg border border-cyan px-4 py-2 text-sm font-bold text-cyan hover:bg-cyan-soft/30">
                  Estimer
                </button>
              </form>
              {simulation && (
                <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">CNSS salariales</dt>
                    <dd className="font-mono tabular-nums">
                      {fmtMad(simulation.cotisationsSalariales)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Revenu net imposable</dt>
                    <dd className="font-mono tabular-nums">{fmtMad(simulation.rni)}</dd>
                  </div>
                  <div className="flex justify-between font-bold">
                    <dt>IR mensuel</dt>
                    <dd className="font-mono tabular-nums">{fmtMad(simulation.ir)}</dd>
                  </div>
                </dl>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
