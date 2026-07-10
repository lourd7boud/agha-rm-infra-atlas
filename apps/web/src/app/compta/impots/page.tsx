// Impôts & échéancier — registre des déclarations fiscales (liasse, solde IS,
// CSS, acomptes, IR, TP…), calcul des acomptes depuis l'IS N-1, simulateur IS.
import { apiGet } from '@/lib/api';
import {
  URGENCE_BADGES,
  fmtDate,
  fmtMad,
  type DeclarationFiscale,
  type Urgence,
} from '@/lib/compta';
import {
  appliquerAcomptes,
  createDeclaration,
  genererEcheancier,
  patchDeclaration,
} from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  KpiCard,
  SectionCard,
  StatusBanners,
  StatutBadge,
  inputClass,
} from '../ui';

export const metadata = { title: 'Impôts & échéancier — Comptabilité ATLAS' };

interface SimulationIs {
  resultatFiscal: number;
  baseProduits: number;
  is: number;
  cotisationMinimale: number;
  impotDu: number;
  css: number;
  tauxIs: number;
}

function urgence(dateEcheance: string, statut: string): Urgence {
  if (statut === 'payee' || statut === 'declaree') return 'fait';
  const jours = Math.floor((new Date(dateEcheance).getTime() - Date.now()) / 86_400_000);
  if (jours < 0) return 'en_retard';
  if (jours <= 7) return 'urgent';
  if (jours <= 30) return 'proche';
  return 'a_venir';
}

export default async function ImpotsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    annee?: string;
    resultat?: string;
    produits?: string;
  }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const [declarations, simulation] = await Promise.all([
    apiGet<DeclarationFiscale[]>(`/compta/declarations?annee=${annee}`),
    params.resultat || params.produits
      ? apiGet<SimulationIs>(
          `/compta/outils/is?resultat=${Number(params.resultat) || 0}&produits=${
            Number(params.produits) || 0
          }`,
        )
      : null,
  ]);

  const enRetard = declarations.filter(
    (d) => urgence(d.dateEcheance, d.statut) === 'en_retard',
  ).length;
  const payees = declarations.filter((d) => d.statut === 'payee').length;
  const totalPaye = declarations
    .filter((d) => d.statut === 'payee')
    .reduce((s, d) => s + d.montant, 0);

  return (
    <div>
      <ComptaHeader
        title="Impôts & échéancier fiscal"
        subtitle="IS (acomptes, solde, cotisation minimale, CSS), IR salaires, taxe professionnelle, liasse — chaque ligne suit son cycle : à venir → à déclarer → déclarée → payée."
        actions={<AnneePicker annee={annee} path="/compta/impots" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="En retard"
          value={enRetard}
          accent={enRetard > 0 ? 'border-l-clay' : 'border-l-emerald'}
        />
        <KpiCard label="Échéances" value={declarations.length} accent="border-l-cyan" />
        <KpiCard label="Payées" value={payees} accent="border-l-emerald" />
        <KpiCard label={`Total payé ${annee}`} value={fmtMad(totalPaye)} accent="border-l-teal" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title={`Échéancier ${annee}`}
            actions={
              <form action={genererEcheancier}>
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value={`/compta/impots?annee=${annee}`} />
                <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-sand">
                  ⚡ Générer / compléter l'année
                </button>
              </form>
            }
          >
            {declarations.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                Aucune échéance — générez l'année pour créer liasse, acomptes IS, IR, TP, CSS…
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Échéance</th>
                    <th className="px-3 py-2 text-left">Déclaration</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-left">Avancer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {declarations.map((d) => {
                    const u = urgence(d.dateEcheance, d.statut);
                    const badge = URGENCE_BADGES[u];
                    const next =
                      d.statut === 'a_venir'
                        ? 'a_declarer'
                        : d.statut === 'a_declarer'
                          ? 'declaree'
                          : d.statut === 'declaree'
                            ? 'payee'
                            : null;
                    return (
                      <tr key={d.id} className="transition hover:bg-sand/40">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex w-18 justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-xs tabular-nums">
                              {fmtDate(d.dateEcheance)}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-72 px-3 py-2">
                          <span className="block truncate text-sm" title={d.label}>
                            {d.label}
                          </span>
                          {d.note && (
                            <span className="block truncate text-[10px] text-faint">{d.note}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <form action={patchDeclaration} className="flex justify-end gap-1">
                            <input type="hidden" name="id" value={d.id} />
                            <input
                              type="hidden"
                              name="backTo"
                              value={`/compta/impots?annee=${annee}`}
                            />
                            <input
                              name="montant"
                              inputMode="decimal"
                              defaultValue={d.montant || ''}
                              placeholder="0,00"
                              className="w-28 rounded border border-line bg-paper px-2 py-1 text-right font-mono text-xs tabular-nums outline-none focus:border-cyan"
                            />
                            <button
                              className="rounded bg-sand px-1.5 text-[10px] font-bold text-muted"
                              title="Enregistrer le montant"
                            >
                              ✓
                            </button>
                          </form>
                        </td>
                        <td className="px-3 py-2">
                          <StatutBadge statut={d.statut} />
                        </td>
                        <td className="px-3 py-2">
                          {next && (
                            <form action={patchDeclaration}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="statut" value={next} />
                              <input
                                type="hidden"
                                name="backTo"
                                value={`/compta/impots?annee=${annee}`}
                              />
                              <button className="rounded bg-cyan-soft/50 px-2 py-0.5 text-[11px] font-bold text-cyan hover:bg-cyan-soft">
                                →{' '}
                                {next === 'a_declarer'
                                  ? 'À déclarer'
                                  : next === 'declaree'
                                    ? 'Déclarée'
                                    : 'Payée'}
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Acomptes IS depuis N-1"
            subtitle="4 × 25 % de max(IS, CM) de l'exercice précédent."
          >
            <form action={appliquerAcomptes} className="space-y-3 px-5 py-4">
              <input type="hidden" name="annee" value={annee} />
              <input type="hidden" name="backTo" value={`/compta/impots?annee=${annee}`} />
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                IS calculé {annee - 1}
                <input
                  name="isN1"
                  inputMode="decimal"
                  placeholder="80 000"
                  className={`${inputClass} text-right font-mono`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Cotisation minimale {annee - 1}
                <input
                  name="cotisationMinimaleN1"
                  inputMode="decimal"
                  placeholder="25 000"
                  className={`${inputClass} text-right font-mono`}
                />
              </label>
              <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
                Calculer & appliquer aux 4 acomptes
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Simulateur IS / CM / CSS"
            subtitle="Estimation de l'impôt de l'exercice."
          >
            <form className="space-y-3 px-5 py-4">
              <input type="hidden" name="annee" value={annee} />
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Résultat fiscal estimé
                <input
                  name="resultat"
                  inputMode="decimal"
                  defaultValue={params.resultat ?? ''}
                  className={`${inputClass} text-right font-mono`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Produits imposables (base CM)
                <input
                  name="produits"
                  inputMode="decimal"
                  defaultValue={params.produits ?? ''}
                  className={`${inputClass} text-right font-mono`}
                />
              </label>
              <button className="w-full rounded-lg border border-cyan px-4 py-2 text-sm font-bold text-cyan hover:bg-cyan-soft/30">
                Simuler
              </button>
            </form>
            {simulation && (
              <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">IS ({simulation.tauxIs} %)</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(simulation.is)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Cotisation minimale</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtMad(simulation.cotisationMinimale)}
                  </dd>
                </div>
                <div className="flex justify-between font-bold">
                  <dt>Impôt dû (max)</dt>
                  <dd className="font-mono tabular-nums text-ink">{fmtMad(simulation.impotDu)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">CSS (si bénéfice ≥ 1 M)</dt>
                  <dd className="font-mono tabular-nums">{fmtMad(simulation.css)}</dd>
                </div>
              </dl>
            )}
          </SectionCard>

          <SectionCard title="Ajouter une échéance libre">
            <form action={createDeclaration} className="space-y-3 px-5 py-4">
              <input type="hidden" name="annee" value={annee} />
              <input type="hidden" name="backTo" value={`/compta/impots?annee=${annee}`} />
              <input name="label" required placeholder="Libellé…" className={inputClass} />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  name="montant"
                  inputMode="decimal"
                  placeholder="Montant"
                  className={`${inputClass} text-right font-mono`}
                />
                <input
                  type="date"
                  name="dateEcheance"
                  required
                  className={`${inputClass} font-mono`}
                />
              </div>
              <button className="w-full rounded-lg bg-sand px-4 py-2 text-sm font-bold text-ink-2 hover:bg-line">
                Ajouter
              </button>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
