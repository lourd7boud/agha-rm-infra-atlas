import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Agent AGHA-RM-INFRA BPU proxy — POST fills the bordereau des prix (body:
 * optional { rabaisPct }); GET returns the last stored proposal.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  // Re-serialize only the one known field — never pipe an arbitrary-size
  // client body to core (the upstream schema would reject it anyway, but the
  // BFF should not carry megabytes for a { rabaisPct } payload).
  let body = '{}';
  try {
    const raw = (await req.json()) as unknown;
    if (raw && typeof raw === 'object' && 'rabaisPct' in raw) {
      body = JSON.stringify({
        rabaisPct: (raw as Record<string, unknown>).rabaisPct,
      });
    }
  } catch {
    // Empty/invalid JSON → forward the empty object; core validates.
  }
  const upstream = await fetch(
    `${API_URL}/expert/tenders/${encodeURIComponent(id)}/bpu`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body,
      cache: 'no-store',
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const upstream = await fetch(
    `${API_URL}/expert/tenders/${encodeURIComponent(id)}/bpu`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
