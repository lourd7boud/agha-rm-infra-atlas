'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REAUTH_WINDOW_NAME, openReauthWindow } from '@/lib/reauth-window';
import {
  classifySessionProbeFailure,
  classifySessionProbeResponse,
  nextSessionProbeDelayMs,
  type SessionProbeOutcome,
} from '@/lib/session-check';

interface SessionStatusResponse {
  authenticated?: boolean;
}

const PROBE_TIMEOUT_MS = 10_000;

function probeSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
    : undefined;
}

/**
 * Background session keeper for the authenticated shell.
 *
 * Contract (pure policy lives in lib/session-check.ts):
 *  - the probe runs on a central cadence, ONLY while the tab is visible, with an
 *    exponential backoff while the answer is unknown, and is single-flight: N
 *    concurrent triggers share one request, so a burst of 401-prone calls can
 *    never fire several token refreshes at once;
 *  - it NEVER reloads, NEVER navigates, NEVER re-renders the route, NEVER blanks
 *    the page, NEVER clears a form and NEVER shows a notice on a timer. A healthy
 *    session is completely invisible to the operator;
 *  - only a server-confirmed 401 marks the session unusable. 5xx / 429 / offline
 *    are "unknown": silent + backoff. Conflating them is what used to paint a
 *    recurring « Session expirée » banner on a perfectly valid session;
 *  - when the session really is unusable the operator keeps reading and editing
 *    every page. The only signal is a compact corner reminder with popup
 *    re-authentication (current route, component state and unsaved input are all
 *    preserved), and a protected form submit is held back with an explicit
 *    message instead of losing the input to a doomed request.
 */

export function AuthSessionBoundary({ children }: { children: React.ReactNode }) {
  const [outcome, setOutcome] = useState<SessionProbeOutcome>('ok');
  const [blockedSubmit, setBlockedSubmit] = useState(false);

  const unknownStreakRef = useRef(0);
  const outcomeRef = useRef<SessionProbeOutcome>('ok');
  const inFlightRef = useRef<Promise<SessionProbeOutcome> | null>(null);
  const timerRef = useRef<number | null>(null);

  const applyOutcome = useCallback((next: SessionProbeOutcome) => {
    outcomeRef.current = next;
    unknownStreakRef.current = next === 'unknown' ? unknownStreakRef.current + 1 : 0;
    setOutcome(next);
    if (next === 'ok') setBlockedSubmit(false);
  }, []);

  /** Single-flight probe: every concurrent caller awaits the same request. */
  const probeSession = useCallback((): Promise<SessionProbeOutcome> => {
    if (inFlightRef.current) return inFlightRef.current;
    const request = (async () => {
      try {
        const response = await fetch('/api/auth/status', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: probeSignal(),
        });
        const body = response.ok
          ? ((await response.json()) as SessionStatusResponse)
          : undefined;
        return classifySessionProbeResponse({
          status: response.status,
          authenticated: body?.authenticated,
        });
      } catch {
        return classifySessionProbeFailure();
      }
    })();
    inFlightRef.current = request.finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, []);

  // Background cadence. Nothing here touches the UI: the schedule simply keeps
  // the Auth.js JWT rotated while the operator works, and re-checks on return.
  useEffect(() => {
    let disposed = false;

    const scheduleNext = () => {
      if (disposed) return;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // A hidden tab does no session work at all; coming back probes again.
      if (document.visibilityState === 'hidden') return;
      timerRef.current = window.setTimeout(
        () => void runProbe(),
        nextSessionProbeDelayMs(unknownStreakRef.current),
      );
    };

    const runProbe = async () => {
      const next = await probeSession();
      if (disposed) return;
      applyOutcome(next);
      scheduleNext();
    };

    const onForeground = () => {
      if (document.visibilityState !== 'hidden') void runProbe();
    };

    void runProbe();
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    // BFCache restore (back/forward): re-check quietly, never navigate.
    window.addEventListener('pageshow', onForeground);

    return () => {
      disposed = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      window.removeEventListener('pageshow', onForeground);
    };
  }, [applyOutcome, probeSession]);

  // A protected action attempted without a usable session is held back BEFORE a
  // request is sent: nothing is submitted, nothing is cleared, nothing is lost.
  useEffect(() => {
    const onSubmit = (event: Event) => {
      if (outcomeRef.current !== 'unauthenticated') return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.sessionFree === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      setBlockedSubmit(true);
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, []);

  // The re-auth popup renders the shell once SSO succeeded: it has nothing left
  // to do, so it closes itself and the operator stays on the page that kept
  // their work (the original tab never navigated).
  useEffect(() => {
    if (window.opener && window.name === REAUTH_WINDOW_NAME) window.close();
  }, []);

  const sessionUnusable = outcome === 'unauthenticated';

  return (
    <>
      {children}
      {sessionUnusable && (
        <div
          role="status"
          aria-live="polite"
          data-testid="session-notice"
          className="pointer-events-none fixed bottom-4 right-4 z-[70] flex justify-end px-4"
        >
          <div className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border border-ochre/50 bg-paper-2/95 px-3 py-1.5 text-xs shadow-raised backdrop-blur">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ochre" />
            {blockedSubmit ? (
              <p className="min-w-0 leading-snug">
                <span className="font-semibold text-ink">Session expirée.</span>{' '}
                <span className="text-muted">
                  Vos saisies restent à l&apos;écran — reconnectez-vous pour enregistrer.
                </span>
              </p>
            ) : (
              <p className="min-w-0 leading-snug text-muted">
                Session à renouveler — vos données restent affichées.
              </p>
            )}
            <button
              type="button"
              onClick={openReauthWindow}
              className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper transition hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
            >
              Se reconnecter
            </button>
          </div>
        </div>
      )}
    </>
  );
}
