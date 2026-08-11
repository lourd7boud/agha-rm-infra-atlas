// Radar proactif (Niveau 4) — l'agent qui trie le bruit: parmi des dizaines de
// milliers d'avis, il pousse en tête les marchés qui COLLENT à AGHA RM INFRA
// (métier, proximité Boudnib, délai tenable, taille, concurrence observée).
// L'opérateur poursuit ou écarte; le brief quotidien part tout seul.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad } from '@/lib/btp';
import {
  joursRestants,
  RADAR_DIMENSIONS,
  RADAR_STATUT_BADGES,
  scoreColor,
  type RadarCandidatesPayload,
} from '@/lib/radar';
import { scanRadar, setCandidatStatut } from './actions';

export const metadata = { title: 'Radar proactif — ATLAS' };

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function CountdownChip({ deadlineAt }: { deadlineAt: string }) {
  const jours = joursRestants(deadlineAt);
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

/** Anneau de score — la lecture instantanée « ça vaut le coup ou pas ». */
function ScoreRing({ score }: { score: number }) {
  const c = scoreColor(score);
  return (
    <div
      className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-[3px] ${c.ring} ${c.bg}`}
    >
      <span className={`font-mono text-xl font-black leading-none tabular-nums ${c.text}`}>
        {score}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">/100</span>
    </div>
  );
}

/** Micro-barres de ventilation: pourquoi ce score, dimension par dimension. */
function BreakdownBars({ breakdown }: { breakdown: Record<string, number> }) {
  const dims = RADAR_DIMENSIONS.filter((d) => breakdown[d.key] != null);
  if (dims.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
      {dims.map((d) => {
        const v = Math.max(0, Math.min(1, breakdown[d.key]));
        const pct = Math.round(v * 100);
        const tone =
          v >= 0.7 ? 'bg-emerald' : v >= 0.45 ? 'bg-cyan' : v >= 0.3 ? 'bg-ochre' : 'bg-clay';
        return (
          <div key={d.key} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[10px] font-medium text-faint">
              {d.label}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand">
              <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const statut = query.statut ?? '';
  const minScore = query.minScore ?? '';
  const search = query.q ?? '';

  const params = new URLSearchParams();
  if (statut) params.set('statut', statut);
  if (minScore) params.set('minScore', minScore);
  if (search) params.set('search', search);
  params.set('page', String(page));
  params.set('limit', '15');

  const data = await apiGet<RadarCandidatesPayload>(`/radar/candidates?${params.toString()}`);
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const baseQs = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { statut, minScore, q: search, ...over };
    if (merged.statut) qs.set('statut', merged.statut);
    if (merged.minScore) qs.set('minScore', merged.minScore);
    if (merged.q) qs.set('q', merged.q);
    if (over.page) qs.set('page', over.page);
    const s = qs.toString();
    return `/tenders/radar${s ? `?${s}` : ''}`;
  };
  const backTo = baseQs({ page: page > 1 ? String(page) : undefined });

  const kpis = [
    { label: 'Opportunités en cours', value: data.stats.total },
    { label: 'À traiter', value: data.stats.nouveaux },
    { label: 'À poursuivre', value: data.stats.poursuivis },
    { label: 'Score max', value: data.stats.scoreMax },
  ];

  return (
    <div className="px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan">
            Marchés &amp; Prospection
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight">
            <span aria-hidden>🎯</span> Radar proactif
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            L&apos;agent trie le bruit pour vous: il score chaque marché en cours selon votre
            métier, la proximité de Boudnib, le délai, la taille et la concurrence observée — et
            met en tête ce qui mérite votre énergie.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tenders/bc/resultats"
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            📊 Intelligence concurrents
          </Link>
          <form action={scanRadar}>
            <input type="hidden" name="backTo" value={backTo} />
            <button
              type="submit"
              className="rounded-lg bg-cyan px-5 py-2.5 text-sm font-bold text-paper transition hover:opacity-90"
            >
              ⟳ Relancer le scoring
            </button>
          </form>
        </div>
      </div>

      {query.scanned && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Scoring relancé — les opportunités sont réévaluées et reclassées.
        </div>
      )}
      {query.error && (
        <div className="mt-4 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay">
          L&apos;action a échoué — réessayez dans un instant.
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
        <form className="flex flex-1 items-center gap-2" action="/tenders/radar" method="get">
          <input
            name="q"
            defaultValue={search}
            placeholder="Objet, acheteur, référence…"
            className="w-full max-w-md rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan"
          />
          {statut && <input type="hidden" name="statut" value={statut} />}
          {minScore && <input type="hidden" name="minScore" value={minScore} />}
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
          >
            Rechercher
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: '', label: 'Tous' },
            { key: 'nouveau', label: 'À traiter' },
            { key: 'poursuivi', label: 'À poursuivre' },
            { key: 'ecarte', label: 'Écartés' },
          ].map((f) => (
            <Link
              key={f.key || 'tous'}
              href={baseQs({ statut: f.key || undefined, page: undefined })}
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
            href={baseQs({ minScore: minScore === '60' ? undefined : '60', page: undefined })}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              minScore === '60' ? 'bg-emerald-soft text-emerald' : 'border border-line text-muted'
            }`}
            title="Ne montrer que les scores ≥ 60"
          >
            ⭐ Score ≥ 60
          </Link>
        </div>
      </div>

      {/* Liste des opportunités scorées */}
      {data.items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-line bg-paper-2 p-10 text-center">
          <p className="text-lg font-semibold">Aucune opportunité scorée</p>
          <p className="mt-1 text-sm text-muted">
            Lancez « Relancer le scoring » — l&apos;agent évaluera les marchés en cours et fera
            remonter ceux qui vous correspondent.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {data.items.map((c) => {
            const badge = RADAR_STATUT_BADGES[c.statut] ?? {
              label: c.statut,
              classes: 'bg-sand text-muted',
            };
            const lieu = c.ville || c.region || c.location || 'Lieu non précisé';
            return (
              <div
                key={c.id}
                className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm transition hover:border-cyan hover:shadow-md"
              >
                <div className="flex items-start gap-4">
                  <ScoreRing score={c.score} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-cyan">{c.reference}</span>
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        <CountdownChip deadlineAt={c.deadlineAt} />
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-ink-2">
                      {c.objet}
                    </p>
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                      <div className="flex gap-1.5">
                        <dt className="text-faint">Acheteur</dt>
                        <dd className="max-w-xs truncate font-medium">{c.buyerName}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-faint">Lieu</dt>
                        <dd className="font-medium">{lieu}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-faint">Catégorie</dt>
                        <dd className="font-medium">{c.category ?? '—'}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-faint">Estimation</dt>
                        <dd className="font-mono font-medium">
                          {c.estimationMad != null ? fmtMad(c.estimationMad) : '—'}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-faint">Échéance</dt>
                        <dd className="font-mono">{fmtDate(c.deadlineAt)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {/* Pourquoi ce score */}
                {c.reasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.reasons.slice(0, 5).map((r, i) => (
                      <span
                        key={i}
                        className="rounded-md bg-sand px-2 py-0.5 text-[11px] font-medium text-ink-2"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                <BreakdownBars breakdown={c.breakdown} />

                {/* Décision de l'opérateur */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Link
                    href={`/tenders/${c.tenderId}`}
                    className="rounded-lg bg-cyan px-4 py-1.5 text-xs font-bold text-paper transition hover:opacity-90"
                  >
                    Ouvrir la fiche →
                  </Link>
                  {c.statut !== 'poursuivi' && (
                    <form action={setCandidatStatut}>
                      <input type="hidden" name="tenderId" value={c.tenderId} />
                      <input type="hidden" name="statut" value="poursuivi" />
                      <input type="hidden" name="backTo" value={backTo} />
                      <button
                        type="submit"
                        className="rounded-lg border border-emerald px-4 py-1.5 text-xs font-semibold text-emerald transition hover:bg-emerald-soft"
                      >
                        ✓ Poursuivre
                      </button>
                    </form>
                  )}
                  {c.statut !== 'ecarte' && (
                    <form action={setCandidatStatut}>
                      <input type="hidden" name="tenderId" value={c.tenderId} />
                      <input type="hidden" name="statut" value="ecarte" />
                      <input type="hidden" name="backTo" value={backTo} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-4 py-1.5 text-xs font-semibold text-muted transition hover:border-clay hover:text-clay"
                      >
                        ✕ Écarter
                      </button>
                    </form>
                  )}
                  {c.sourceUrl && (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-xs font-medium text-faint transition hover:text-cyan"
                    >
                      Portail ↗
                    </a>
                  )}
                </div>
              </div>
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
            {page} / {pages} — {data.total} opportunités
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
