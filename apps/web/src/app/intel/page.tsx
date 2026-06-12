import { apiGet } from '@/lib/api';

interface CompetitorStats {
  canonicalName: string;
  wins: number;
  totalMad: number;
}

interface PublishedResult {
  id: string;
  reference: string;
  buyerName: string;
  bidderName: string;
  amountMad?: number;
  resultDate?: string;
}

export default async function IntelPage() {
  const [competitors, results] = await Promise.all([
    apiGet<CompetitorStats[]>('/intel/competitors'),
    apiGet<PublishedResult[]>('/intel/results?limit=50'),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">
          Intelligence marché
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Résultats publiés uniquement (C1 — Result Miner) : qui gagne quoi, à
          quel prix
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Concurrents ({competitors.length})
          </h2>
          <ul className="divide-y divide-slate-100">
            {competitors.map((competitor) => (
              <li
                key={competitor.canonicalName}
                className="flex items-baseline justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-semibold">{competitor.canonicalName}</p>
                  <p className="text-xs text-slate-400">
                    {competitor.wins} marché{competitor.wins > 1 ? 's' : ''} remporté
                    {competitor.wins > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="font-mono text-sm tabular-nums text-slate-700">
                  {competitor.totalMad.toLocaleString('fr-MA')} MAD
                </span>
              </li>
            ))}
          </ul>
          {competitors.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">
              Aucun concurrent identifié — lancer une moisson.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Résultats publiés récents
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Acheteur</th>
                <th className="px-4 py-3">Attributaire</th>
                <th className="px-4 py-3 text-right">Montant TTC</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((result) => (
                <tr key={result.id}>
                  <td className="px-4 py-3 font-semibold">{result.reference}</td>
                  <td className="px-4 py-3 text-slate-600">{result.buyerName}</td>
                  <td className="px-4 py-3 text-slate-600">{result.bidderName}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {result.amountMad
                      ? `${result.amountMad.toLocaleString('fr-MA')} MAD`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-500">
                    {result.resultDate
                      ? new Date(result.resultDate).toLocaleDateString('fr-MA')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">
              Aucun résultat moissonné.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
