import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Assistant IA proxy — forwards the NL question to core's POST /tender/assistant
 * with the session bearer attached, returns {filters, answer, matchedCount,
 * topRefs, model} as JSON. Single-flight on core, no streaming.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const upstream = await fetch(`${API_URL}/tender/assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: await req.text(),
    cache: 'no-store',
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
