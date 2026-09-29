import { safeCallbackUrl } from '@/lib/callback-url';

interface BlockingCheckResult {
  blocking: boolean;
  requestId: number;
  latestBlockingRequestId: number;
  usable: boolean;
}

export function shouldReleaseBlockingSessionCheck({
  blocking,
  requestId,
  latestBlockingRequestId,
  usable,
}: BlockingCheckResult): boolean {
  return blocking && usable && requestId === latestBlockingRequestId;
}

// ── Background session watchdog policy ───────────────────────────────────────
//
// Central, pure policy for `AuthSessionBoundary`. The contract it encodes:
//  - a probe NEVER navigates, never blanks the page, never blocks input and
//    never shows a loading state;
//  - ONLY an explicit 401 means the session is unusable. A 5xx, a 429, a bad
//    gateway page or a network hiccup is "unknown" and must never be reported
//    to the operator as an expired session (the previous watchdog conflated the
//    two, so a 500 from the probe endpoint looked like "Session expirée");
//  - failures back off exponentially (bounded) so an outage cannot turn into a
//    request loop;
//  - the cadence lives here — one place, no scattered timers.

export type SessionProbeOutcome = 'ok' | 'unauthenticated' | 'unknown';

/**
 * Default cadence. Kept below the 300 s Keycloak access-token TTL so the Auth.js
 * JWT callback keeps rotating the token in the background and a tab left open
 * never lapses into an unusable session.
 */
export const SESSION_PROBE_INTERVAL_MS = 4 * 60_000;
/** Upper bound of the backoff (an outage must not hammer the endpoint). */
export const SESSION_PROBE_MAX_INTERVAL_MS = 15 * 60_000;
export const SESSION_PROBE_BACKOFF_FACTOR = 2;

/** Classify an HTTP answer from the session probe endpoint. */
export function classifySessionProbeResponse(input: {
  status: number;
  authenticated?: boolean;
}): SessionProbeOutcome {
  if (input.status === 401) return 'unauthenticated';
  if (input.status >= 200 && input.status < 300) {
    return input.authenticated === false ? 'unauthenticated' : 'ok';
  }
  // 403 (role problem), 429, 5xx, redirects… say nothing about the session.
  return 'unknown';
}

/** A thrown fetch (offline, DNS, CORS, timeout) is never an expired session. */
export function classifySessionProbeFailure(): SessionProbeOutcome {
  return 'unknown';
}

/** Exponential backoff on consecutive "unknown" outcomes, capped. */
export function nextSessionProbeDelayMs(
  unknownStreak: number,
  base: number = SESSION_PROBE_INTERVAL_MS,
  max: number = SESSION_PROBE_MAX_INTERVAL_MS,
): number {
  if (unknownStreak <= 0) return base;
  const steps = Math.min(unknownStreak, 8);
  return Math.min(max, base * SESSION_PROBE_BACKOFF_FACTOR ** steps);
}

/**
 * Re-authentication target that returns the operator to the exact page they
 * were working on (validated same-origin path, never the login screen itself).
 */
export function buildReauthUrl(loginPath: string, currentLocation: string): string {
  return `${loginPath}?callbackUrl=${encodeURIComponent(safeCallbackUrl(currentLocation))}`;
}

