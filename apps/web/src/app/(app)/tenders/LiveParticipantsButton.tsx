'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * "Intel concurrents" button — the datao-beating surface.
 *
 * On click it opens a popover that fills with REAL data from ATLAS's harvested
 * PV/result history (intel.competitor_bid):
 *   - CLOSED tender → the actual participants + amounts + winner (same-day,
 *     ahead of datao's daily snapshot).
 *   - OPEN tender → predictive intel: the firms that most often bid THIS buyer,
 *     their win counts, and the typical winning-rebate level (helps pricing).
 * Plus the live PMMP deadline (to spot extensions vs our stored deadline).
 */

interface Participant {
  name: string;
  amountMad: number | null;
  isWinner: boolean;
}
interface LikelyCompetitor {
  name: string;
  timesSeen: number;
  wins: number;
  avgAmountMad: number | null;
}
interface CompetitorIntel {
  mode: 'closed' | 'open';
  reference: string;
  buyerName: string;
  participants: Participant[];
  winner: Participant | null;
  likelyCompetitors: LikelyCompetitor[];
  buyerHistoryCount: number;
  buyerMedianRebatePct: number | null;
}
interface LiveParticipants {
  deadline: string | null;
  authenticated: boolean;
}

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR').format(n) + ' DH';
}
function fmtDeadline(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
  } catch {
    return '—';
  }
}

export function LiveParticipantsButton({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [intel, setIntel] = useState<CompetitorIntel | null>(null);
  const [live, setLive] = useState<LiveParticipants | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Competitor intel is the primary payload; PMMP live deadline is a
      // best-effort secondary (it 503s cleanly when creds are absent).
      const [intelRes, liveRes] = await Promise.all([
        fetch(`/api/tender/tenders/${encodeURIComponent(tenderId)}/competitor-intel`),
        fetch(`/api/tender/tenders/${encodeURIComponent(tenderId)}/live-participants`).catch(
          () => null,
        ),
      ]);
      if (!intelRes.ok) throw new Error(`HTTP ${intelRes.status}`);
      setIntel((await intelRes.json()) as CompetitorIntel);
      if (liveRes && liveRes.ok) setLive((await liveRes.json()) as LiveParticipants);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClick(): Promise<void> {
    if (!open) {
      setOpen(true);
      if (!intel) await load();
    } else {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title="Intelligence concurrents — participants réels ou historique de l'acheteur"
        className="flex items-center gap-1.5 rounded-md border border-clay/40 bg-clay-soft/40 px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay-soft"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-clay" />
        </span>
        Intel concurrents
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Intelligence concurrents"
          className="absolute right-0 top-9 z-50 w-80 rounded-lg border border-line bg-paper-2 p-3 shadow-raised"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Intel concurrents
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="rounded-md p-1 text-faint hover:bg-sand hover:text-ink"
            >
              <Icon name="close" size={14} />
            </button>
          </div>

          {busy ? (
            <p className="py-4 text-center text-xs text-muted">Analyse de l'historique…</p>
          ) : error ? (
            <div className="rounded-md bg-clay-soft/50 p-2 text-xs text-clay">{error}</div>
          ) : intel ? (
            <>
              {intel.mode === 'closed' ? (
                <>
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-soft px-2 py-0.5 text-[10px] font-semibold text-emerald">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                    Résultat réel — {intel.participants.length} concurrent(s)
                  </div>
                  <ul className="space-y-1">
                    {intel.participants.map((p, i) => (
                      <li
                        key={`${p.name}-${i}`}
                        className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 ${
                          p.isWinner
                            ? 'border-emerald/40 bg-emerald-soft/40'
                            : 'border-line bg-paper'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {p.isWinner ? (
                            <Icon name="check" size={12} className="shrink-0 text-emerald" />
                          ) : null}
                          <span className="truncate text-xs text-ink-2" title={p.name}>
                            {p.name}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">
                          {fmtMad(p.amountMad)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cyan-soft px-2 py-0.5 text-[10px] font-semibold text-cyan">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
                    Prédictif — historique acheteur ({intel.buyerHistoryCount} marché(s))
                  </div>
                  {intel.buyerMedianRebatePct != null ? (
                    <p className="mb-2 rounded-md bg-ochre-soft/40 px-2 py-1.5 text-[11px] text-ochre-deep">
                      Rabais médian gagnant chez cet acheteur :{' '}
                      <span className="font-mono font-bold tabular-nums">
                        {intel.buyerMedianRebatePct.toFixed(1)}%
                      </span>
                    </p>
                  ) : null}
                  {intel.likelyCompetitors.length > 0 ? (
                    <>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">
                        Concurrents probables
                      </p>
                      <ul className="space-y-1">
                        {intel.likelyCompetitors.map((c, i) => (
                          <li
                            key={`${c.name}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper px-2 py-1.5"
                          >
                            <span className="truncate text-xs text-ink-2" title={c.name}>
                              {c.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                              {c.timesSeen}× · {c.wins}✓
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="py-3 text-center text-[11px] text-faint">
                      Pas encore d'historique pour cet acheteur — la base
                      s'enrichit à chaque récolte de PV.
                    </p>
                  )}
                </>
              )}

              <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
                <p>
                  Échéance portail :{' '}
                  <span className="font-mono tabular-nums text-ink-2">
                    {fmtDeadline(live?.deadline ?? null)}
                  </span>
                </p>
              </div>
            </>
          ) : (
            <p className="py-4 text-center text-xs text-muted">Chargement…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
