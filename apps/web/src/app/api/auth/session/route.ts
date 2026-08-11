import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isUsableSession } from '@/lib/auth-session';

/**
 * Keep Auth.js' browser-facing session endpoint credential-free. Server code
 * still receives the encrypted-JWT-backed access and ID tokens through auth().
 */
export const GET = auth((request) => {
  const session = request.auth;
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
});
