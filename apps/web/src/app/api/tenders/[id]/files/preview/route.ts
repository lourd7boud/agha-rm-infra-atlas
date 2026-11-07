import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** Authenticated same-origin proxy for ATLAS Core's local LibreOffice preview. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 });

  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const upstream = await fetch(
    `${API_URL}/tender/tenders/${encodeURIComponent(id)}/dossier/preview?name=${encodeURIComponent(name)}`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: req.signal,
    },
  );
  if (!upstream.ok) {
    const payload = await upstream.text();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="apercu-document.pdf"',
      'Cache-Control': 'private, max-age=600',
    },
  });
}
