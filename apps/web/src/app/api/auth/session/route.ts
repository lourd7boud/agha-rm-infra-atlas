import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isUsableSession } from '@/lib/auth-session';

/**
 * Keep Auth.js' browser-facing session endpoint credential-free. Server code
 * still receives the encrypted-JWT-backed access and ID tokens through auth().
 *
 * Like `/api/auth/status`, this must read the session with `await auth()` and
 * NOT with the `auth(handler)` wrapper: the app's Auth.js config is built lazily
 * (`NextAuth((request) => …)`), and wrapping a handler with that form throws
 * `TypeError: Function.prototype.apply was called on #<Promise>` → HTTP 500.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const authenticated = isUsableSession(session);

  return NextResponse.json(
    authenticated
      ? {
          user: session.user,
          roles: session.roles ?? [],
          authenticated: true,
          expires: session.expires,
        }
      : { authenticated: false },
    {
      status: authenticated ? 200 : 401,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Cookie',
      },
    },
  );
}
