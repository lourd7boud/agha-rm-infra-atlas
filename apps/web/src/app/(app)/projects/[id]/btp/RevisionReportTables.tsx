import Link from 'next/link';
import { fmtDate, fmtMadPrecise, type RevisionReport } from '@/lib/btp-shared';

const number = (value: number | null | undefined, digits = 2) => value == null ? '—'
  : value.toLocaleString('fr-MA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const indexNumber = (value: number | undefined) => value == null ? '—'
  : value.toLocaleString('fr-MA', { minimumFractionDigits: 1, maximumFractionDigits: 6 });
const monthName = (value: string) => new Intl.DateTimeFormat('fr-MA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
const cell = 'border border-line px-3 py-2.5 align-middle';
const numericCell = `${cell} text-right tabular-nums whitespace-nowrap`;
const header = `${cell} font-semibold text-ink-2`;

export function RevisionReportTables({ report, projectId }: { report: RevisionReport; projectId: string }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-paper-2">
        <h3 className="border-b border-line px-5 py-4 font-semibold">Calcul des coefficients</h3>
        {report.coefficientGroups.length === 0 && <p className="px-5 py-4 text-sm text-muted">Les indices et coefficients apparaissent dès que la formule, la référence et les dates des travaux permettent le calcul.</p>}
        {report.coefficientGroups.map((group) => (
          <div key={group.id} className="p-5">
            {report.coefficientGroups.length > 1 && <h4 className="mb-3 text-sm font-semibold">{group.label}</h4>}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-cyan-soft">
                  <tr>
                    <th rowSpan={2} className={header}>Mois</th>
                    <th colSpan={Math.max(group.indices.length, 1)} className={`${header} text-center`}>Indices</th>
                    <th colSpan={Math.max(group.indices.length, 1)} className={`${header} text-center`}>Rapports à la base</th>
                    <th rowSpan={2} className={header}>Variation du mois<br />C = K − 1</th>
                    <th rowSpan={2} className={header}>Publication</th>
                  </tr>
                  <tr>
                    {(group.indices.length ? group.indices : ['—']).map((code) => <th key={code} className={header}>{code}</th>)}
                    {(group.indices.length ? group.indices : ['—']).map((code) => <th key={code} className={header}>{code}/{code}₀</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-ochre-soft/30">
                    <th className={`${cell} font-medium`}>{group.baseDate ? monthName(group.baseDate.slice(0, 7)) : 'Base à renseigner'}</th>
                    {(group.indices.length ? group.indices : ['—']).map((code) => <td key={code} className={numericCell}>{indexNumber(group.baseValues[code])}</td>)}
                    <td colSpan={Math.max(group.indices.length, 1) + 2} className={`${cell} text-muted`}>
                      Époque de base · {fmtDate(group.baseDate)}
                      {group.manualBaseIndices?.length ? ` · Valeurs saisies manuellement (${group.manualBaseIndices.join(', ')})`
                        : group.basePublication?.source && ` · ${group.basePublication.source}`}
                    </td>
                  </tr>
                  {group.months.map((month, index) => (
                    <tr key={`${month.month}-${index}`}>
                      <th className={`${cell} font-medium whitespace-nowrap`}>{monthName(month.month)}</th>
                      {(group.indices.length ? group.indices : ['—']).map((code) => <td key={code} className={numericCell}>{indexNumber(month.values[code])}</td>)}
                      {(group.indices.length ? group.indices : ['—']).map((code) => <td key={code} className={`${numericCell} bg-cyan-soft/20`}>{number(month.ratios[code], 4)}</td>)}
                      <td className={`${numericCell} bg-ochre-soft/25 font-semibold`}>{number(month.coefficient, 4)}</td>
                      <td className={`${cell} text-muted`}>
                        {month.publication?.source ?? 'En attente'}
                        {month.publication && <span className="mt-1 block">{month.publication.publishedOn ? fmtDate(month.publication.publishedOn) : 'Date de publication à vérifier'} · {month.publication.status === 'definitif' ? 'définitif' : 'provisoire'}</span>}
                      </td>
                    </tr>
                  ))}
                  <tr><td colSpan={Math.max(group.indices.length, 1) * 2 + 3} className={`${cell} text-center text-muted`}>{group.formula}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-paper-2">
        <h3 className="border-b border-line px-5 py-4 font-semibold">Calcul de la révision</h3>
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[65rem] border-collapse text-left text-xs">
            <thead className="bg-cyan-soft">
              <tr>{['N° décompte', 'Début des travaux', 'Arrêté du métré', 'Établissement', 'Mois', 'Jours du mois', 'Total jours', 'Variation du mois', 'Coefficient moyen', 'Montant à réviser HT', 'Révision HT'].map((label) => <th key={label} className={header}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {report.baseDate && <tr className="bg-ochre-soft/30"><td className={cell} /><td className={cell}>{fmtDate(report.baseDate)}</td><td colSpan={9} className={`${cell} text-muted`}>Époque de base</td></tr>}
              {report.project.ordreServiceDate && <tr className="bg-ochre-soft/30"><td className={cell} /><td className={cell}>{fmtDate(report.project.ordreServiceDate)}</td><td colSpan={9} className={`${cell} text-muted`}>Ordre de service de commencement</td></tr>}
              {report.rows.flatMap((row) => {
                const count = Math.max(row.months.length, 1);
                const monthly = row.months.length ? row.months : [null];
                const rows = monthly.map((month, index) => (
                  <tr key={`${row.decompteId}-${index}`} id={index === 0 ? `revision-${row.decompteId}` : undefined}>
                    {index === 0 && <>
                      <th rowSpan={count} className={`${cell} font-medium`}>
                        {row.numero}{row.isDernier ? ' et dernier' : ''}
                        {row.origin === 'reconstituted' && <span className="mt-1 block text-[10px] text-muted">Reconstitution</span>}
                      </th>
                      <td rowSpan={count} className={`${cell} whitespace-nowrap`}>{fmtDate(row.start)}</td>
                      <td rowSpan={count} className={`${cell} whitespace-nowrap`}>{fmtDate(row.end)}</td>
                      <td rowSpan={count} className={`${cell} whitespace-nowrap`}>{fmtDate(row.dateDecompte)}</td>
                    </>}
                    <td className={`${cell} whitespace-nowrap`}>{month ? monthName(month.month) : 'En attente'}
                      {month?.priceBasis && <span className="mt-1 block text-[10px] text-muted">{month.priceBasis.label}</span>}
                    </td>
                    <td className={numericCell}>{month?.days ?? '—'}</td>
                    {index === 0 && <td rowSpan={count} className={numericCell}>{row.totalDays ?? '—'}</td>}
                    <td className={numericCell}>{number(month?.coefficient, 4)}
                      {month?.contractCoefficient != null && <span className="mt-1 block whitespace-normal text-[10px] text-muted">
                        Borne délai {number(month.contractCoefficient, 4)}<br />
                        {month.contractPublication?.source}
                        {month.contractPublication && !month.contractPublication.publishedOn && <span className="block">Publication à vérifier</span>}
                      </span>}
                    </td>
                    {index === 0 && <>
                      <td rowSpan={count} className={numericCell}>{number(row.appliedCoefficient, 4)}</td>
                      <td rowSpan={count} className={numericCell}>{number(row.ht)}</td>
                      <td rowSpan={count} className={`${numericCell} font-semibold`}>{number(row.amount)}</td>
                    </>}
                  </tr>
                ));
                const notes = [...row.issues, ...row.warnings];
                if (notes.length) rows.push(<tr key={`${row.decompteId}-notes`}><td className={cell}>{row.numero}</td><td colSpan={10} className={`${cell} text-ochre`}>{[...new Set(notes)].join(' ')}</td></tr>);
                return rows;
              })}
              {report.rows.length === 0 && <tr><td colSpan={11} className={`${cell} text-muted`}>Enregistrez le premier métré pour alimenter l’état de la révision.</td></tr>}
            </tbody>
            <tfoot className="bg-cyan-soft">
              <tr><th colSpan={10} className={`${cell} text-right font-semibold`}>Montant total de la révision HT</th><td className={`${numericCell} text-base font-bold`}>{report.summary.calculatedTotal == null ? 'En attente' : fmtMadPrecise(report.summary.calculatedTotal)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
          <p>Les montants reprennent le calcul mensuel. Le coefficient moyen résume la pondération du HT exécuté.</p>
          <Link href={`/projects/${projectId}?section=admin&tab=decomptes`} className="font-semibold text-cyan underline">Décomptes associés</Link>
        </div>
      </section>
    </div>
  );
}
