'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtMad } from '@/lib/projects';

/**
 * Analyse du résultat — the marchecal.com/analyse.php surface, in-house. A
 * datao-style side panel docked to the LEFT of the 640px tender drawer (same
 * pattern as the Bordereau side panel), fed by GET /api/tender/tenders/:id/analyse
 * which computes the winner + prix de référence from the live portal
 * dépouillement. The operator opens it from the drawer with one click instead
 * of copy-pasting the consultation URL into a third-party site.
 */

interface AnalyseBidder {
  entreprise: string;
  adminStatus: string;
  finStatus: string;
  avantMad: number | null;
  apresMad: number | null;
  amountMad: number | null;
  admissible: boolean;
  diffVsMoPct: number | null;
}

interface AnalyseLot {
  name: string;
  bidders: AnalyseBidder[];
  estimationMad: number | null;
  referencePrice: number | null;
  winner: AnalyseBidder | null;
  winningAmount: number | null;
  diffWinnerVsMoPct: number | null;
  diffWinnerVsRefPct: number | null;
}

interface AnalyseResponse {
  reference: string;
  buyerName: string;
  objet: string;
  category: string | null;
  location: string | null;
  cautionProvisoireMad: number | null;
  deadlineAt: string;
  sourceUrl?: string;
  hasResults: boolean;
  estimationMad: number | null;
  lots: AnalyseLot[];
}

const fmtPct2 = (v: number | null | undefined): string =>
  v == null ? '—' : `${v.toLocaleString('fr-MA', { maximumFractionDigits: 2 })} %`;

/** Signed % chip: green when below the reference (good for a bid), red above. */
function DiffChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-faint">N/A</span>;
  const cls =
    value < 0 ? 'text-emerald' : value > 0 ? 'text-rose' : 'text-faint';
  return (
    <span className={`font-semibold ${cls}`}>
      {value > 0 ? '↗' : value < 0 ? '↘' : ''} {fmtPct2(value)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const ok =
    /admissible/i.test(status) && !/non\s*admissible|écart|ecart/i.test(status);
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        ok ? 'bg-emerald-soft text-emerald' : 'bg-rose/10 text-rose'
      }`}
    >
      {status || '—'}
    </span>
  );
}

export function AnalysePanel({
  tenderId,
  onClose,
}: {
  tenderId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AnalyseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lotIdx, setLotIdx] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setLotIdx(0);
    (async () => {
      try {
        const res = await fetch(`/api/tender/tenders/${tenderId}/analyse`, {
          cache: 'no-store',
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && (body.error as string)) ??
              (body && (body.message as string)) ??
              `HTTP ${res.status}`,
          );
        }
        if (!cancelled) setData(body as AnalyseResponse);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lots = data?.lots ?? [];
  const lot = lots[Math.min(lotIdx, lots.length - 1)];
  const filteredBidders = (lot?.bidders ?? []).filter((b) =>
    query.trim()
      ? b.entreprise.toLowerCase().includes(query.trim().toLowerCase())
      : true,
  );

  return (
    <div
      className="fixed inset-y-0 right-[640px] z-[59] flex w-full max-w-[680px] flex-col border-r border-line bg-paper shadow-raised"
      role="dialog"
      aria-modal="false"
      aria-label="Analyse du résultat"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-ink">
          <Icon name="analytics" size={16} className="shrink-0 text-cyan" />
          <span className="truncate">Analyse du résultat</span>
          {data && (
            <span className="truncate font-mono text-xs font-normal text-faint">
              {data.reference}
            </span>
          )}
        </p>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted hover:bg-sand hover:text-ink"
          aria-label="Fermer"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-cyan" />
            <p className="text-sm">Analyse du dépouillement en cours…</p>
            <p className="text-xs text-faint">
              Lecture en direct du portail des marchés publics.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose/30 bg-rose/5 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose">
              <Icon name="alert" size={15} /> Analyse indisponible
            </p>
            <p className="mt-1 text-sm text-ink-2">{error}</p>
            <p className="mt-2 text-xs text-faint">
              Le portail peut être momentanément injoignable ou limiter les
              requêtes — réessayez dans un instant.
            </p>
          </div>
        ) : !data || !data.hasResults || !lot ? (
          <div className="rounded-xl border border-line bg-sand/40 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-ink">
              Résultat non encore publié
            </p>
            <p className="mt-1 text-sm text-muted">
              La commission n&apos;a pas encore publié le dépouillement de cette
              consultation sur le portail. L&apos;analyse sera disponible dès la
              parution des offres.
            </p>
          </div>
        ) : (
          <>
            {/* Top summary cards (marchecal "Gagnants / Prix de Référence / Prix gagnant") */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
                <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-faint">
                  🏆 Gagnant
                </p>
                {lots.map((l) => (
                  <p key={l.name} className="mt-1 text-sm font-semibold text-ink">
                    {lots.length > 1 && (
                      <span className="text-faint">{l.name} : </span>
                    )}
                    {l.winner?.entreprise ?? '—'}
                  </p>
                ))}
              </div>
              <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-faint">
                  Prix de Référence
                </p>
                {lots.map((l) => (
                  <p key={l.name} className="mt-1 font-mono text-sm font-semibold text-ink">
                    {lots.length > 1 && (
                      <span className="font-sans text-faint">{l.name} : </span>
                    )}
                    {l.referencePrice != null ? fmtMad(l.referencePrice) : '—'}
                  </p>
                ))}
              </div>
              <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-faint">
                  Prix gagnant
                </p>
                {lots.map((l) => (
                  <p key={l.name} className="mt-1 font-mono text-sm font-semibold text-ink">
                    {lots.length > 1 && (
                      <span className="font-sans text-faint">{l.name} : </span>
                    )}
                    {l.winningAmount != null ? fmtMad(l.winningAmount) : '—'}
                  </p>
                ))}
              </div>
            </div>

            {/* Informations générales */}
            <section className="mt-3 overflow-hidden rounded-xl border border-line">
              <p className="bg-cyan px-3 py-2 text-xs font-bold uppercase tracking-wide text-paper">
                Informations générales
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 text-sm">
                <div>
                  <dt className="text-xs text-faint">Référence</dt>
                  <dd className="font-mono text-ink">{data.reference}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Catégorie</dt>
                  <dd className="text-ink">{data.category ?? '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-faint">Acheteur public</dt>
                  <dd className="text-ink">{data.buyerName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Lieu d&apos;exécution</dt>
                  <dd className="text-ink">{data.location ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Estimation MO</dt>
                  <dd className="font-mono text-ink">
                    {lot.estimationMad != null ? fmtMad(lot.estimationMad) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Caution</dt>
                  <dd className="font-mono text-ink">
                    {data.cautionProvisoireMad != null
                      ? fmtMad(data.cautionProvisoireMad)
                      : '—'}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Lot tabs (multi-lot only) */}
            {lots.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {lots.map((l, i) => (
                  <button
                    key={l.name}
                    onClick={() => setLotIdx(i)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      i === lotIdx
                        ? 'bg-cyan text-paper'
                        : 'border border-line text-ink-2 hover:bg-sand'
                    }`}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}

            {/* Résumé du lot + Tableau des offres */}
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
              {/* Résumé du lot */}
              <div className="rounded-xl border border-line px-3 py-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">
                  Résumé — {lot.name}
                </p>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-faint">🏆 Gagnant</dt>
                    <dd className="font-semibold text-ink">
                      {lot.winner?.entreprise ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Prix gagnant</dt>
                    <dd className="font-mono font-semibold text-ink">
                      {lot.winningAmount != null ? fmtMad(lot.winningAmount) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Prix de Référence</dt>
                    <dd className="font-mono text-ink">
                      {lot.referencePrice != null ? fmtMad(lot.referencePrice) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Estimation MO</dt>
                    <dd className="font-mono text-ink">
                      {lot.estimationMad != null ? fmtMad(lot.estimationMad) : '—'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-faint">Gagnant vs Estimation MO</span>
                    <DiffChip value={lot.diffWinnerVsMoPct} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-faint">Gagnant vs Prix de Réf</span>
                    <DiffChip value={lot.diffWinnerVsRefPct} />
                  </div>
                </div>
              </div>

              {/* Tableau des offres */}
              <div className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-faint">
                    Tableau des offres
                  </p>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher une entreprise"
                    className="w-44 rounded-lg border border-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-cyan"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-sand/40 text-[11px] uppercase tracking-wide text-faint">
                        <th className="px-2 py-2 font-semibold">#</th>
                        <th className="px-2 py-2 font-semibold">Entreprise</th>
                        <th className="px-2 py-2 text-right font-semibold">Offre</th>
                        <th className="px-2 py-2 text-right font-semibold">
                          Diff. vs MO
                        </th>
                        <th className="px-2 py-2 text-center font-semibold">Admin</th>
                        <th className="px-2 py-2 text-center font-semibold">Fin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBidders.map((b, i) => {
                        const isWinner =
                          lot.winner != null &&
                          b.entreprise === lot.winner.entreprise;
                        const rank = lot.bidders.indexOf(b);
                        const medal =
                          rank === 0 ? '🏆' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '';
                        return (
                          <tr
                            key={`${b.entreprise}-${i}`}
                            className={`border-b border-line last:border-0 ${
                              isWinner ? 'bg-emerald-soft/40' : ''
                            }`}
                          >
                            <td className="px-2 py-2 align-middle">
                              <span className="mr-1">{medal}</span>
                              {rank + 1}
                            </td>
                            <td className="px-2 py-2 align-middle font-medium text-ink">
                              {b.entreprise}
                            </td>
                            <td className="px-2 py-2 text-right align-middle font-mono text-ink">
                              {b.amountMad != null ? fmtMad(b.amountMad) : 'N/A'}
                            </td>
                            <td className="px-2 py-2 text-right align-middle">
                              <DiffChip value={b.diffVsMoPct} />
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                              <StatusPill status={b.adminStatus} />
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                              <StatusPill status={b.finStatus} />
                            </td>
                          </tr>
                        );
                      })}
                      {filteredBidders.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-6 text-center text-sm text-muted"
                          >
                            Aucune entreprise ne correspond à « {query} ».
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Gagnant présumé = offre admissible la plus proche sous le prix de
              référence (moins-disant corrigé des offres présumément anormalement
              basses), calculé à partir du dépouillement publié sur le portail.
              Le résultat officiel fait foi.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
