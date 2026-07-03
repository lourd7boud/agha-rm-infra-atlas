import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

async function bearer(): Promise<string | null> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') return null;
  return session.accessToken;
}

/**
 * Client-pollable mirror of GET /tender/inventory — used by the tenders explorer
 * for live silent refresh. The browser polls `?since=<lastSeen>&limit=…` and the
 * upstream returns only the rows written since that instant (facets/total stay
 * catalogue-wide), which the client merges in place without a full page reload.
 * Only the inventory query params are forwarded — never arbitrary keys.
 */
const FORWARDED = [
  // Paging + sort + search + delta cursor.
  'limit',
  'offset',
  'sort',
  'dir',
  'q',
  'since',
  // Multi-select filters (comma-separated) — the server-side pagination path.
  'procedures',
  'categories',
  'secteurs',
  'regions',
  'buyers',
  'states',
  'lifecycles',
  // Legacy single-value filters (SSR/preload deep-links still use these).
  'procedure',
  'region',
  'buyer',
  'state',
  'lifecycle',
  // Boolean toggles.
  'bpuOnly',
  'budgetOnly',
  'cautionOnly',
];

export async function GET(req: NextRequest): Promise<Response> {
  const token = await bearer();
  if (!token) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const inQs = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const key of FORWARDED) {
    const v = inQs.get(key);
    if (v != null && v !== '') qs.set(key, v);
  }
  const upstream = await fetch(`${API_URL}/tender/inventory?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
