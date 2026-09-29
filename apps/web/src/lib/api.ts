import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Every server-side fetch to Core MUST carry a deadline. Without one, a single
 * stalled upstream call (saturated DB pool, slow LLM) pins the whole RSC render
 * until nginx gives up at 180 s and the operator sees a blank 504. With one,
 * the caller's try/catch degrades that section instead of killing the page.
 * Reads are dashboard-fast (the slowest legit read, /agents, self-caps at 7 s);
 * writes get 120 s because chat/scenario POSTs legitimately wait on the LLM.
 */
export const API_READ_TIMEOUT_MS = 15_000;
export const API_WRITE_TIMEOUT_MS = 120_000;

/**
 * Production Next.js redacts server-error messages before they reach the
 * client error boundary, but forwards a pre-set `digest` as-is. Carrying
 * the upstream HTTP status in the digest lets error.tsx say WHY it failed
 * (409 transition vs 503 IA indisponible) instead of a generic message.
 */
export class AtlasApiError extends Error {
  readonly digest: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`ATLAS API ${path} a répondu HTTP ${status}`);
    this.status = status;
    this.digest = `ATLAS_API_${status}`;
  }
}

/**
 * The session is missing, expired-and-unrefreshable, or Core answered 401.
 *
 * This is NOT a navigation trigger. `redirect('/login')` from a Server Action or
 * an RSC render tears the operator's page down mid-edit: the route changes, the
 * component tree is replaced and every unsaved field is gone. Throwing instead
 * keeps the page mounted —
 *  - a read surfaces through the segment's `error.tsx` (see the `401` entry in
 *    `app/(app)/error.tsx`), which says « session expirée, vos données sont
 *    conservées » and offers a popup re-authentication;
 *  - a write is caught by the action's own `fail()` and redirected back to the
 *    SAME page with `?error=<action>&code=…`, so the banner names the failed
 *    operation and the input is still on screen.
 *
 * The digest stays `ATLAS_API_401` so the existing status plumbing (error
 * boundaries, action banners, audit logs) classifies it as it always did.
 */
export class AtlasSessionExpiredError extends AtlasApiError {
  constructor(path: string) {
    super(path, 401);
  }
}

/**
 * Read circuit breaker for Core. Per-request deadlines already fail one slow
 * call, but when Core is genuinely unhealthy (DB pool saturated, mid-restart)
 * EVERY read waits the full deadline and the failures stack until the whole RSC
 * tree stalls — the "everything hangs" pathology. The breaker trips after a run
 * of consecutive read failures (timeout / 5xx / network) and then fails fast for
 * a short cooldown, shedding load so Core can recover instead of being hammered.
 * Client/domain errors (401, 404, 409) are NOT failures — they say nothing about
 * Core's health. State is per-process (module scope), matching the cache model.
 */
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 10_000;

const readBreaker: { failures: number; openedAt: number | null } = {
  failures: 0,
  openedAt: null,
};

/** Open while tripped and still inside the cooldown; half-open (one probe) after. */
function readCircuitOpen(now: number): boolean {
  if (readBreaker.openedAt === null) return false;
  if (now - readBreaker.openedAt >= BREAKER_COOLDOWN_MS) return false; // half-open
  return true;
}

function recordReadSuccess(): void {
  readBreaker.failures = 0;
  readBreaker.openedAt = null;
}

function recordReadFailure(now: number): void {
  readBreaker.failures += 1;
  if (readBreaker.failures >= BREAKER_FAILURE_THRESHOLD) {
    readBreaker.openedAt = now;
  }
}

/**
 * Parse a JSON response body, tolerating an EMPTY body. A Nest handler that
 * returns null/undefined (e.g. GET /equipment/:id/meter with no readings, or
 * POST …/generate when nothing is due) produces a 200 with no content, and
 * response.json() would throw "Unexpected end of JSON input". Treat empty as null.
 */
async function parseJsonOrNull<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Server-side fetch against ATLAS Core with the session's bearer token. */
export async function apiGet<T>(
  path: string,
  options?: { timeoutMs?: number },
): Promise<T> {
  const session = await auth();
  // Missing / expired-and-unrefreshable session: report it, never navigate. The
  // section's error boundary explains it while the page, its filters and every
  // unsaved field stay exactly where they are.
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    throw new AtlasSessionExpiredError(path);
  }
  // Fail fast while the breaker is open: Core is unhealthy, so skip the doomed
  // round-trip and let error.tsx degrade this section immediately.
  if (readCircuitOpen(Date.now())) {
    throw new AtlasApiError(path, 503);
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(options?.timeoutMs ?? API_READ_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout (AbortError) or network failure — Core is unreachable/slow.
    recordReadFailure(Date.now());
    throw error;
  }
  if (response.status === 401) {
    throw new AtlasSessionExpiredError(path);
  }
  // 5xx signals Core health; 4xx is a client/domain error and must not trip it.
  if (response.status >= 500) {
    recordReadFailure(Date.now());
    throw new AtlasApiError(path, response.status);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  recordReadSuccess();
  return parseJsonOrNull<T>(response);
}

/** Server-side POST against ATLAS Core (gate actions, agent triggers). */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    throw new AtlasSessionExpiredError(path);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...options?.headers,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? API_WRITE_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new AtlasSessionExpiredError(path);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return parseJsonOrNull<T>(response);
}

/** Server-side PATCH against ATLAS Core (partial updates, e.g. task progress). */
export async function apiPatch<T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    throw new AtlasSessionExpiredError(path);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? API_WRITE_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new AtlasSessionExpiredError(path);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return parseJsonOrNull<T>(response);
}

/** Server-side DELETE against ATLAS Core (removing a resource). */
export async function apiDelete<T>(
  path: string,
  options?: { timeoutMs?: number },
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    throw new AtlasSessionExpiredError(path);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? API_WRITE_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new AtlasSessionExpiredError(path);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return parseJsonOrNull<T>(response);
}
