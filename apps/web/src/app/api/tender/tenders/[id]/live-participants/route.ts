import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

async function bearer(): Promise<string | null> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') return null;
  return session.accessToken;
}

/**
 * BFF proxy for the live-participants endpoint — the feature datao lacks.
 * Forwards the browser call to the authenticated core route that hits PMMP
 * with the AGHID CONSTRUCTION session and returns the four counters (retraits,
 * questions, cautions, messagerie) + the portal's current deadline.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const token = await bearer();
  if (!token) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { id } = await params;
  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_URL}/tender/tenders/${encodeURIComponent(id)}/live-participants`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        // Core's PMMP crawl is capped at 40 s; without our own deadline this
        // proxy inherits undici's 300 s HeadersTimeout and hangs the button.
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    return NextResponse.json(
      { error: 'Le portail PMMP ne répond pas — réessayer dans un instant.' },
      { status: 504 },
    );
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
