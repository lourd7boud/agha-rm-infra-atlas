import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isUsableSession } from '@/lib/auth-session';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Vary: 'Cookie',
};

export const GET = auth((request) => {
  const authenticated = isUsableSession(request.auth);

  return NextResponse.json(
    { authenticated },
    { status: authenticated ? 200 : 401, headers: NO_STORE_HEADERS },
  );
});
