// Bons de commande — la salle de chasse des avis d'achat: KPIs, filtres,
// cartes avec compte à rebours et statut de l'agent chargé. La donnée vient
// du miroir bdc.avis (crawl du module /bdc du portail PMMP).
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad } from '@/lib/btp';
import {
  BDC_STATUT_BADGES,
  joursRestants,
  REPONSE_STATUT_BADGES,
  type BdcListePayload,
} from '@/lib/bdc';
import { syncBdc } from './actions';
import BdcAutoRefresh from './BdcAutoRefresh';

export const metadata = { title: 'Bons de commande — ATLAS' };

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function CountdownChip({ dateLimite }: { dateLimite: string | null }) {
  const jours = joursRestants(dateLimite);
  if (jours === null) return null;
  const classes =
    jours < 0
      ? 'bg-sand text-muted'
      : jours <= 3
        ? 'bg-clay-soft text-clay'
        : jours <= 7
          ? 'bg-ochre-soft text-ochre'
          : 'bg-emerald-soft text-emerald';
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${classes}`}>
      {jours < 0 ? 'Échu' : `J-${jours}`}
    </span>
  );
}

export default async function BdcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const statut = query.statut ?? '';
  const aVenir = query.aVenir !== '0'; // par défaut: uniquement les vivants
  const search = query.q ?? '';

  const params = new URLSearchParams();
  if (statut) params.set('statut', statut);
  if (aVenir) params.set('aVenir', '1');
  if (search) params.set('search', search);
  params.set('page', String(page));
  params.set('limit', '18');

  const data = await apiGet<BdcListePayload>(`/bdc/avis?${params.toString()}`);
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const baseQs = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { statut, q: search, aVenir: aVenir ? '1' : '0', ...over };
    if (merged.statut) qs.set('statut', merged.statut);
    if (merged.q) qs.set('q', merged.q);
    qs.set('aVenir', merged.aVenir ?? '1');
    if (over.page) qs.set('page', over.page);
    return `/tenders/bc?${qs.toString()}`;
  };

  const kpis = [
    { label: 'Avis au catalogue', value: data.stats.total },
    { label: 'En cours', value: data.stats.enCours },
    { label: 'Échéance à venir', value: data.stats.aVenir },
    { label: 'Chiffrés par l’agent', value: data.stats.avecReponse },
  ];

  return (
    <div className="px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan">
            Marchés &amp; Prospection
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Bons de commande</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Tous les avis d&apos;achat publiés sur le portail, avec leurs articles structurés —
            l&apos;agent chargé chiffre, la société dépose.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tenders/bc/resultats"
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            🎯 Résultats &amp; Concurrence
          </Link>
          <form action={syncBdc}>
            <input type="hidden" name="backTo" value={baseQs({})} />
            <button
              type="submit"
              className="rounded-lg bg-cyan px-5 py-2.5 text-sm font-bold text-paper transition hover:opacity-90"
            >
              ⟳ Synchroniser le portail
            </button>
          </form>
        </div>
      </div>
      <BdcAutoRefresh />

      {query.synced && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Portail synchronisé — liste et articles à jour.
        </div>
      )}
      {query.error && (
        <div className="mt-4 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay">
          La synchronisation a échoué — réessayez dans un instant.
        </div>
      )}

      {/* KPIs */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-paper-2 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              {k.label}
            </p>
            <p className="mt-1 font-mono text-2xl font-black tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form className="flex flex-1 items-center gap-2" action="/tenders/bc" method="get">
          <input
            name="q"
            defaultValue={search}
            placeholder="Objet, acheteur, référence…"
            className="w-full max-w-md rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan"
          />
          {statut && <input type="hidden" name="statut" value={statut} />}
          <input type="hidden" name="aVenir" value={aVenir ? '1' : '0'} />
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
            { key: 'en_cours', label: 'En cours' },
            { key: 'attribue', label: 'Attribués' },
            { key: 'annule', label: 'Annulés' },
          ].map((f) => (
            <Link
              key={f.key || 'tous'}
              href={baseQs({ statut: f.key || undefined })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                statut === f.key
                  ? 'bg-cyan text-paper'
                  : 'border border-line text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          ))}
          <Link
            href={baseQs({ aVenir: aVenir ? '0' : '1' })}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              aVenir ? 'bg-emerald-soft text-emerald' : 'border border-line text-muted'
            }`}
            title="Ne montrer que les échéances à venir"
          >
            ⏳ À venir
          </Link>
        </div>
      </div>

      {/* Cartes */}
      {data.items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-line bg-paper-2 p-10 text-center">
          <p className="text-lg font-semibold">Aucun avis dans le miroir</p>
          <p className="mt-1 text-sm text-muted">
            Lancez « Synchroniser le portail » pour importer les avis d&apos;achat publiés.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((avis) => {
            const badge = BDC_STATUT_BADGES[avis.statut] ?? {
              label: avis.statut,
              classes: 'bg-sand text-muted',
            };
            const agent = avis.reponseStatut
              ? (REPONSE_STATUT_BADGES[avis.reponseStatut] ?? null)
              : null;
            return (
              <Link
                key={avis.id}
                href={`/tenders/bc/${avis.id}`}
                className="group flex flex-col rounded-xl border border-line bg-paper-2 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-sm font-bold text-cyan">{avis.reference}</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    <CountdownChip dateLimite={avis.dateLimite} />
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-ink-2">
                  {avis.objet}
                </p>
                <dl className="mt-3 space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Acheteur</dt>
                    <dd className="truncate text-right font-medium">{avis.acheteur}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Lieu · Catégorie</dt>
                    <dd className="truncate text-right">
                      {avis.lieu ?? '—'}
                      {avis.categorie ? ` · ${avis.categorie}` : ''}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Date limite</dt>
                    <dd className="text-right font-mono">{fmtDate(avis.dateLimite)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Articles</dt>
                    <dd className="text-right font-mono">
                      {avis.detailFetchedAt ? avis.articles.length : '…'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                  {agent ? (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${agent.classes}`}
                    >
                      🤖 {agent.label}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-faint">
                      Agent: pas encore chiffré
                    </span>
                  )}
                  {avis.reponseTotalTtc != null && avis.reponseTotalTtc > 0 && (
                    <span className="font-mono text-xs font-bold tabular-nums">
                      {fmtMad(avis.reponseTotalTtc)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link
              href={baseQs({ page: String(page - 1) })}
              className="rounded-lg border border-line px-4 py-2 font-semibold text-muted hover:text-ink"
            >
              ← Précédent
            </Link>
          )}
          <span className="font-mono text-xs text-faint">
            {page} / {pages} — {data.total} avis
          </span>
          {page < pages && (
            <Link
              href={baseQs({ page: String(page + 1) })}
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
