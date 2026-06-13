import Link from 'next/link';
import { apiGet } from '@/lib/api';

interface BuyerBreakdown {
  buyerName: string;
  wins: number;
  totalMad: number;
}

interface ProfileResult {
  id: string;
  reference: string;
  buyerName: string;
  amountMad?: number;
  isWinner: boolean;
  resultDate?: string;
}

interface CompetitorProfile {
  id: string;
  canonicalName: string;
  observations: number;
  wins: number;
  totalWonMad: number;
  avgWinMad: number | null;
  minWinMad: number | null;
  maxWinMad: number | null;
  buyers: BuyerBreakdown[];
  recentResults: ProfileResult[];
  firstSeen: string | null;
  lastSeen: string | null;
}

function fmtMad(value: number | null | undefined): string {
  return value !== null && value !== undefined
    ? `${Math.round(value).toLocaleString('fr-MA')} MAD`
    : '—';
}

export default async function CompetitorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await apiGet<CompetitorProfile>(
    `/intel/competitors/${id}/profile`,
  );

  const stats: { label: string; value: string }[] = [
    { label: 'Marchés remportés', value: String(profile.wins) },
    { label: 'Total remporté', value: fmtMad(profile.totalWonMad) },
    { label: 'Marché moyen', value: fmtMad(profile.avgWinMad) },
    {
      label: 'Plus petit / plus gros',
      value: `${fmtMad(profile.minWinMad)} · ${fmtMad(profile.maxWinMad)}`,
    },
  ];

  return (
    <div>
      <Link href="/intel" className="text-sm text-muted hover:text-ink">
        ← Intelligence marché
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-black tracking-tight">
          {profile.canonicalName}
        </h1>
        <span className="text-sm text-faint">
          {profile.observations} résultat{profile.observations > 1 ? 's' : ''} publié
          {profile.observations > 1 ? 's' : ''}
          {profile.firstSeen &&
            ` · vu de ${new Date(profile.firstSeen).toLocaleDateString('fr-MA')}`}
          {profile.lastSeen &&
            ` à ${new Date(profile.lastSeen).toLocaleDateString('fr-MA')}`}
        </span>
      </div>
      <p className="mb-8 text-xs text-faint">
        Profil C2 — construit uniquement sur les résultats publiés par le portail.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              {stat.label}
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Acheteurs ({profile.buyers.length})
          </h2>
          <ul className="divide-y divide-line">
            {profile.buyers.map((buyer) => (
              <li
                key={buyer.buyerName}
                className="flex items-baseline justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-semibold">{buyer.buyerName}</p>
                  <p className="text-xs text-faint">
                    {buyer.wins} marché{buyer.wins > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="font-mono text-sm tabular-nums text-ink-2">
                  {fmtMad(buyer.totalMad)}
                </span>
              </li>
            ))}
          </ul>
          {profile.buyers.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucun marché remporté observé.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Derniers résultats publiés
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Acheteur</th>
                <th className="px-4 py-3 text-right">Montant</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {profile.recentResults.map((result) => (
                <tr key={result.id}>
                  <td className="px-4 py-3 font-semibold">{result.reference}</td>
                  <td className="px-4 py-3 text-muted">{result.buyerName}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(result.amountMad)}
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
          {profile.recentResults.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucun résultat daté.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
