'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * "Live PMMP" button — the feature datao does not have. On click, hits the
 * authenticated live-participants endpoint (server side) and pops up the four
 * counters PMMP exposes only to logged-in callers: retraits, questions,
 * cautions, messagerie. Reads the tender's current PMMP-side deadline too so
 * an operator spots an extension against the deadline_at we already store.
 */

interface LiveParticipantsResponse {
  refConsultation: string;
  orgAcronyme: string;
  retraits: number | null;
  questions: number | null;
  cautions: number | null;
  messagerie: number | null;
  deadline: string | null;
  fetchedAt: string;
  sourceUrl: string;
  authenticated: boolean;
}

function fmtNumOrDash(n: number | null | undefined): string {
  return n == null ? '—' : n.toString();
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
  } catch {
    return '—';
  }
}

export function LiveParticipantsButton({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LiveParticipantsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tender/tenders/${encodeURIComponent(tenderId)}/live-participants`,
      );
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(
          body?.message ?? 'Compte PMMP non configuré (PORTAL_AUTH_LOGIN/PASSWORD).',
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LiveParticipantsResponse;
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClick(): Promise<void> {
    if (!open) {
      setOpen(true);
      if (!data) await load();
    } else {
      setOpen(false);
    }
  }

  async function refresh(): Promise<void> {
    setData(null);
    await load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title="Compteurs live PMMP (retraits · questions · cautions)"
        className="flex items-center gap-1.5 rounded-md border border-clay/40 bg-clay-soft/40 px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay-soft"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-clay" />
        </span>
        Live PMMP
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Compteurs live PMMP"
          className="absolute right-0 top-9 z-50 w-72 rounded-lg border border-line bg-paper-2 p-3 shadow-raised"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Live · PMMP
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
            <p className="py-4 text-center text-xs text-muted">Interrogation du portail…</p>
          ) : error ? (
            <div className="rounded-md bg-clay-soft/50 p-2 text-xs text-clay">
              {error}
            </div>
          ) : data ? (
            <>
              <ul className="grid grid-cols-2 gap-2">
                <li className="rounded-md border border-line bg-paper p-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">Retraits</p>
                  <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-cyan">
                    {fmtNumOrDash(data.retraits)}
                  </p>
                  <p className="text-[10px] text-faint">DCE téléchargés</p>
                </li>
                <li className="rounded-md border border-line bg-paper p-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">Cautions</p>
                  <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald">
                    {fmtNumOrDash(data.cautions)}
                  </p>
                  <p className="text-[10px] text-faint">candidats sérieux</p>
                </li>
                <li className="rounded-md border border-line bg-paper p-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">Questions</p>
                  <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ochre">
                    {fmtNumOrDash(data.questions)}
                  </p>
                  <p className="text-[10px] text-faint">Q&amp;A publiques</p>
                </li>
                <li className="rounded-md border border-line bg-paper p-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">Messages</p>
                  <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-teal">
                    {fmtNumOrDash(data.messagerie)}
                  </p>
                  <p className="text-[10px] text-faint">messagerie sécurisée</p>
                </li>
              </ul>

              <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
                <p>
                  Échéance portail :{' '}
                  <span className="font-mono tabular-nums text-ink-2">
                    {fmtDeadline(data.deadline)}
                  </span>
                </p>
                {data.authenticated ? (
                  <p className="mt-0.5 text-emerald">Session AGHID authentifiée</p>
                ) : (
                  <p className="mt-0.5 text-clay">Session anonyme — compteurs masqués</p>
                )}
              </div>

              <button
                type="button"
                onClick={refresh}
                disabled={busy}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-line px-2 py-1.5 text-[11px] font-medium text-ink transition hover:bg-sand disabled:opacity-50"
              >
                <Icon name="activity" size={12} />
                Actualiser
              </button>
            </>
          ) : (
            <p className="py-4 text-center text-xs text-muted">Chargement…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
