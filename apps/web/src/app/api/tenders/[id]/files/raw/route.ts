import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { isDceRawInlineSafe } from '@/lib/dce-file-kind';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** Streams ONE document out of a tender's DCE ZIP (authenticated, same-origin)
 *  with the right content-type so the viewer renders it inline — PDF in an
 *  iframe, image in an <img>, or as a download. `?name=` is the exact zip entry
 *  path from the /files listing. Office files use the authenticated local
 *  /files/preview conversion route for inline viewing. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const name = req.nextUrl.searchParams.get('name');
  const sha256 = req.nextUrl.searchParams.get('sha256');
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) return NextResponse.json({ error: 'Empreinte du fichier invalide' }, { status: 400 });

  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const query = new URLSearchParams({ name });
  if (sha256) query.set('sha256', sha256);
  const upstream = await fetch(
    `${API_URL}/tender/tenders/${encodeURIComponent(id)}/dossier/raw?${query}`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: req.signal,
    },
  );
  if (!upstream.ok) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': `${isDceRawInlineSafe(name) ? 'inline' : 'attachment'}; filename="document"`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
