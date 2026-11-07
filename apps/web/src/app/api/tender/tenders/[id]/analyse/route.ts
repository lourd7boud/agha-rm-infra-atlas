import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * BFF proxy for the live "Analyse du résultat" (marchecal parity): the core
 * fetches the public dépouillement for the tender's consultation and computes
 * the winner + prix de référence. We forward the bearer token and stream the
 * JSON straight through (200 analysis / 400 no-URL / 502 portal block).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const upstream = await fetch(
      `${API_URL}/tender/tenders/${encodeURIComponent(id)}/analyse`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      },
    );
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Analyse indisponible (core injoignable)' },
      { status: 502 },
    );
  }
}
