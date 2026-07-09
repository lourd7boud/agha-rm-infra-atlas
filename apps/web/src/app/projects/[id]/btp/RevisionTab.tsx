// Révision des prix — configuration (formule + époque de base) et table
// d'analyse par décompte (coefficient pondéré par jours, TRUNC Excel).
// La révision n'est APPLIQUÉE que sur le décompte « et dernier ».
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMadPrecise, type BtpProjectDetail, type RevisionView } from '@/lib/btp';
import { saveRevisionConfig } from '../actions';

export async function RevisionTab({ project }: { project: BtpProjectDetail }) {
  const view = await apiGet<RevisionView>(`/btp/projects/${project.id}/revision`);
  const { config, formulas, formula, table } = view;
  const baseIndexNames = formula ? Object.keys(formula.weights) : [];
  const missingBase = baseIndexNames.filter((name) => !(config?.baseIndexes ?? {})[name]);
  const anyMissingMonths = table.some((row) => row.missingMonths.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Révision des prix</h2>
          <p className="text-xs text-muted">
            P = P₀ × [a + Σ wᵢ·(Iᵢ/Iᵢ₀)] — coefficients TRUNC(4), montants TRUNC(2), pondérés par
            jours. Appliquée automatiquement sur le décompte « et dernier ».
          </p>
        </div>
        <Link
          href="/projects/indexes"
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
        >
          Gérer les index mensuels →
        </Link>
      </div>

      {/* Alertes */}
      {config?.isEnabled && missingBase.length > 0 && (
        <div className="rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay">
          Index de base manquants : {missingBase.join(', ')} — la révision ne peut pas être
          calculée sans l'époque de base complète.
        </div>
      )}
      {config?.isEnabled && anyMissingMonths && (
        <div className="rounded-xl border border-ochre-soft bg-ochre-soft/20 px-5 py-3 text-sm font-medium text-ochre">
          Des mois sans index publiés existent dans les périodes — leurs jours comptent avec un
          coefficient nul. Complétez la table des index.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Configuration */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Configuration du marché
          </h3>
          <form action={saveRevisionConfig} className="mt-4 space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
              <input
                type="checkbox"
                name="isEnabled"
                defaultChecked={config?.isEnabled ?? false}
                className="accent-cyan"
              />
              Révision activée pour ce marché
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-faint">
              Formule
              <select
                name="formulaId"
                defaultValue={config?.formulaId ?? ''}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              >
                <option value="">— Aucune —</option>
                {formulas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (a={f.fixedPart})
                  </option>
                ))}
              </select>
            </label>
            {formula && (
              <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-muted">
                <p className="font-semibold text-ink-2">{formula.name}</p>
                <p className="mt-1 font-mono">
                  a = {formula.fixedPart} ·{' '}
                  {Object.entries(formula.weights)
                    .map(([k, w]) => `${w}·(${k}/${k}₀)`)
                    .join(' + ')}
                </p>
              </div>
            )}
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-faint">
              Date de l'époque de base
              <input
                type="date"
                name="baseDate"
                defaultValue={config?.baseDate?.slice(0, 10) ?? ''}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-faint">
              Index de base (JSON)
              <textarea
                name="baseIndexes"
                rows={4}
                defaultValue={JSON.stringify(config?.baseIndexes ?? {}, null, 1)}
                placeholder='{"At": 306.7, "Cs": 134.6}'
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
              />
            </label>
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              Enregistrer & recalculer
            </button>
          </form>
        </section>

        {/* Table d'analyse */}
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm lg:col-span-2">
          <h3 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Calcul par décompte
          </h3>
          {table.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Aucun décompte — créez des métrés d'abord.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-3">N°</th>
                    <th className="px-4 py-3">Période</th>
                    <th className="px-4 py-3 text-right">Jours</th>
                    <th className="px-4 py-3 text-right">Coefficient</th>
                    <th className="px-4 py-3 text-right">Montant à réviser (HT)</th>
                    <th className="px-4 py-3 text-right">Révision</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {table.map((row) => (
                    <tr key={row.decompteId} className="align-top">
                      <td className="px-4 py-3 font-mono font-bold text-cyan">{row.numero}</td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {row.periodeLibelle ?? '—'}
                        {row.details.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-faint hover:text-cyan">
                              détail mensuel
                            </summary>
                            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                              {row.details.map((d) => (
                                <li key={d.month} className={d.missingIndexes ? 'text-clay' : ''}>
                                  {d.month}: {d.days} j × {d.coefficient.toFixed(4)}
                                  {d.missingIndexes ? ' (index manquants)' : ''}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {row.totalDays ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {row.coefficient !== null ? row.coefficient.toFixed(4) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {fmtMadPrecise(row.montantAReviser)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-emerald">
                        {row.montantRevision !== null ? fmtMadPrecise(row.montantRevision) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row.applied && (
                          <span className="rounded-full bg-emerald-soft px-2 py-0.5 text-[10px] font-bold text-emerald">
                            appliquée
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-[11px] text-faint">
            Le tableau est une analyse période par période (HT non cumulé). Le moteur applique la
            révision au décompte « et dernier » sur son HT cumulé — visible dans le détail du
            décompte.
          </p>
        </section>
      </div>
    </div>
  );
}
