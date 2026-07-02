import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Agent AGHA-RM-INFRA knowledge proxy — what the agent has learned from the
 * whole catalogue (market map, participation, rebate memory). Lives under
 * /api/tender/ so the existing nginx browser-route (→ web BFF) covers it.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const upstream = await fetch(`${API_URL}/expert/knowledge`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
