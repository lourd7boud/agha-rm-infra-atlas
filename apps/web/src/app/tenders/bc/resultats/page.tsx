// Résultats & Concurrence — le gisement intelligence des bons de commande:
// qui gagne, chez quel acheteur, à quel montant, contre combien de devis.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad } from '@/lib/btp';
import { ISSUE_BADGES, type BdcResultatsPayload } from '@/lib/bdc';

export const metadata = { title: 'Résultats BC — ATLAS' };

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default async function BdcResultatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const issue = query.issue ?? '';
  const search = query.q ?? '';

  const params = new URLSearchParams();
  if (issue) params.set('issue', issue);
  if (search) params.set('search', search);
  params.set('page', String(page));
  params.set('limit', '20');

  const data = await apiGet<BdcResultatsPayload>(`/bdc/resultats?${params.toString()}`);
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const qs = (over: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    const merged = { issue, q: search, ...over };
    if (merged.issue) usp.set('issue', merged.issue);
    if (merged.q) usp.set('q', merged.q);
    if (over.page) usp.set('page', over.page);
    const s = usp.toString();
    return `/tenders/bc/resultats${s ? `?${s}` : ''}`;
  };

  const kpis = [
    { label: 'Résultats au miroir', value: data.stats.total.toLocaleString('fr-MA') },
    { label: 'Attribués', value: data.stats.attribues.toLocaleString('fr-MA') },
    { label: 'Infructueux', value: data.stats.infructueux.toLocaleString('fr-MA') },
    { label: 'Montant total attribué', value: fmtMad(data.stats.montantTotal) },
    { label: 'Acheteurs couverts', value: data.stats.acheteurs.toLocaleString('fr-MA') },
    { label: 'Entreprises gagnantes', value: data.stats.attributaires.toLocaleString('fr-MA') },
  ];

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/tenders/bc" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Bons de commande
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan">
            Marchés &amp; Prospection
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Résultats &amp; Concurrence</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Chaque résultat publié nourrit l&apos;intelligence: le miroir grandit à chaque
            synchronisation et révèle qui gagne, où, et à quel prix.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-paper-2 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              {k.label}
            </p>
            <p className="mt-1 font-mono text-xl font-black tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 items-center gap-2"
          action="/tenders/bc/resultats"
          method="get"
        >
          <input
            name="q"
            defaultValue={search}
            placeholder="Acheteur, gagnant, objet, référence…"
            className="w-full max-w-md rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan"
          />
          {issue && <input type="hidden" name="issue" value={issue} />}
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
          >
            Rechercher
          </button>
        </form>
        <div className="flex items-center gap-1.5">
          {[
            { key: '', label: 'Tous' },
            { key: 'attribue', label: 'Attribués' },
            { key: 'infructueux', label: 'Infructueux' },
          ].map((f) => (
            <Link
              key={f.key || 'tous'}
              href={qs({ issue: f.key || undefined })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                issue === f.key
                  ? 'bg-cyan text-paper'
                  : 'border border-line text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Résultats */}
      {data.items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-line bg-paper-2 p-10 text-center">
          <p className="text-lg font-semibold">Aucun résultat au miroir</p>
          <p className="mt-1 text-sm text-muted">
            Lancez « Synchroniser le portail » depuis la liste des bons de commande — les
            résultats récents s&apos;importent à chaque balayage.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper-2 shadow-sm">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                <th className="px-5 py-3">Référence</th>
                <th className="py-3 pr-3">Objet</th>
                <th className="py-3 pr-3">Acheteur</th>
                <th className="py-3 pr-3">Date</th>
                <th className="py-3 pr-3 text-right">Devis reçus</th>
                <th className="py-3 pr-3">Issue</th>
                <th className="py-3 pr-3">Gagnant</th>
                <th className="py-3 pr-5 text-right">Montant TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((r) => {
                const badge = ISSUE_BADGES[r.issue] ?? {
                  label: r.issue,
                  classes: 'bg-sand text-muted',
                };
                return (
                  <tr key={r.id} className="align-top transition hover:bg-paper">
                    <td className="px-5 py-2.5 font-mono text-xs font-bold text-cyan">
                      {r.reference}
                    </td>
                    <td className="max-w-[260px] py-2.5 pr-3 text-muted">
                      <span className="line-clamp-2">{r.objet}</span>
                    </td>
                    <td className="max-w-[200px] py-2.5 pr-3">
                      <Link
                        href={qs({ q: r.acheteur })}
                        className="line-clamp-2 font-medium hover:text-cyan"
                        title="Voir tous les résultats de cet acheteur"
                      >
                        {r.acheteur}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{fmtDate(r.dateResultat)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                      {r.nbDevis ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="max-w-[160px] py-2.5 pr-3 font-semibold">
                      {r.attributaire ?? '—'}
                    </td>
                    <td className="py-2.5 pr-5 text-right font-mono font-bold tabular-nums">
                      {r.montantTtc != null ? fmtMad(r.montantTtc) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link
              href={qs({ page: String(page - 1) })}
              className="rounded-lg border border-line px-4 py-2 font-semibold text-muted hover:text-ink"
            >
              ← Précédent
            </Link>
          )}
          <span className="font-mono text-xs text-faint">
            {page} / {pages} — {data.total.toLocaleString('fr-MA')} résultats
          </span>
          {page < pages && (
            <Link
              href={qs({ page: String(page + 1) })}
              className="rounded-lg border border-line px-4 py-2 font-semibold text-muted hover:text-ink"
            >
              Suivant →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
