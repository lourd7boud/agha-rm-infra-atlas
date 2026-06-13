import Link from 'next/link';
import { apiGet } from '@/lib/api';

interface CompetitorStats {
  id: string;
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
        <p className="mt-1 text-sm text-muted">
          Résultats publiés uniquement (C1 — Result Miner) : qui gagne quoi, à
          quel prix
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <section className="rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Concurrents ({competitors.length})
          </h2>
          <ul className="divide-y divide-line">
            {competitors.map((competitor) => (
              <li key={competitor.id}>
                <Link
                  href={`/intel/${competitor.id}`}
                  className="flex items-baseline justify-between gap-3 px-5 py-3 transition hover:bg-sand"
                >
                  <div>
                    <p className="text-sm font-semibold">{competitor.canonicalName}</p>
                    <p className="text-xs text-faint">
                      {competitor.wins} marché{competitor.wins > 1 ? 's' : ''} remporté
                      {competitor.wins > 1 ? 's' : ''} — voir le profil
                    </p>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-ink-2">
                    {competitor.totalMad.toLocaleString('fr-MA')} MAD
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {competitors.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucun concurrent identifié — lancer une moisson.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Résultats publiés récents
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Acheteur</th>
                <th className="px-4 py-3">Attributaire</th>
                <th className="px-4 py-3 text-right">Montant TTC</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((result) => (
                <tr key={result.id}>
                  <td className="px-4 py-3 font-semibold">{result.reference}</td>
                  <td className="px-4 py-3 text-muted">{result.buyerName}</td>
                  <td className="px-4 py-3 text-muted">{result.bidderName}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {result.amountMad
                      ? `${result.amountMad.toLocaleString('fr-MA')} MAD`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {result.resultDate
                      ? new Date(result.resultDate).toLocaleDateString('fr-MA')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucun résultat moissonné.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
