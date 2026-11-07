import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isUsableSession } from '@/lib/auth-session';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Vary: 'Cookie',
};

/**
 * Usability probe for the background session watchdog (`AuthSessionBoundary`).
 *
 * Read the session with `await auth()` — NOT with the `auth(handler)` wrapper.
 * This app builds Auth.js from a *lazy* config (`NextAuth((request) => …)`), and
 * wrapping a Route Handler with that form throws
 * `TypeError: Function.prototype.apply was called on #<Promise>` → the route
 * answered 500, which the watchdog read as "session expired" and turned into a
 * recurring banner + a forced trip back to /login on an otherwise healthy
 * session. A plain handler keeps the exact same contract (200 + `{authenticated:
 * true}`, 401 + `{authenticated:false}`) and still lets Auth.js rotate the
 * session cookie through `cookies()` when the JWT callback refreshed the token.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const authenticated = isUsableSession(session);

  return NextResponse.json(
    { authenticated },
    { status: authenticated ? 200 : 401, headers: NO_STORE_HEADERS },
  );
}
