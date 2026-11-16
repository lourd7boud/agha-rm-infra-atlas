import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const PRIVATE = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };

function isSameOriginAccountRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (!origin || (site && site !== 'same-origin')) return false;
  if (origin === req.nextUrl.origin) return true;
  try {
    return origin === new URL(process.env.AUTH_URL ?? '').origin;
  } catch {
    return false;
  }
}

async function proxy(req: NextRequest, context: Context, method: 'GET' | 'POST'): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE });
  }
  const modes = req.nextUrl.searchParams.getAll('mode');
  const account = method === 'POST' && modes.length === 1 && modes[0] === 'account';
  if (modes.length && !account) {
    return NextResponse.json({ error: 'Mode de contrôle invalide' }, { status: 400, headers: PRIVATE });
  }
  if (account && !isSameOriginAccountRequest(req)) {
    return NextResponse.json({ error: 'Origine non autorisée' }, { status: 403, headers: PRIVATE });
  }
  const { id } = await context.params;
  try {
    const query = account ? '?mode=account' : '';
    const upstream = await fetch(`${API_URL}/tender/tenders/${encodeURIComponent(id)}/dossier/revision${query}`, {
      method, headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store', signal: AbortSignal.any([req.signal, AbortSignal.timeout(method === 'POST' ? 240_000 : 15_000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const retryAfter = upstream.headers.get('retry-after');
      const headers = upstream.status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter)
        ? { ...PRIVATE, 'Retry-After': retryAfter } : PRIVATE;
      return NextResponse.json({ error: 'Contrôle de version indisponible' }, { status: upstream.status, headers });
    }
    return NextResponse.json(await upstream.json(), { headers: PRIVATE });
  } catch {
    return NextResponse.json({ error: 'Contrôle de version indisponible' }, { status: 503, headers: PRIVATE });
  }
}

/** GET reads saved evidence; only an explicit POST contacts the official source. */
export const GET = (req: NextRequest, context: Context): Promise<Response> => proxy(req, context, 'GET');
export const POST = (req: NextRequest, context: Context): Promise<Response> => proxy(req, context, 'POST');
