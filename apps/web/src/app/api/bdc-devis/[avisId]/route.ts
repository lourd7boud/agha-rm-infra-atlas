// BFF du bordereau BDC (XLSX) — porte le bearer token vers le core et relaie
// le flux binaire (même patron que /api/compta-doc). Nécessite la carve-out
// nginx /api/bdc-devis/ → web.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ avisId: string }> },
) {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const { avisId } = await params;
  if (!UUID_RE.test(avisId)) {
    return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 });
  }
  const upstream = await fetch(`${API_URL}/bdc/avis/${avisId}/bordereau.xlsx`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Bordereau indisponible (HTTP ${upstream.status})` },
      { status: upstream.status },
    );
  }
  const headers: Record<string, string> = {
    'Content-Type':
      upstream.headers.get('Content-Type') ??
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Cache-Control': 'no-store',
  };
  const disposition = upstream.headers.get('Content-Disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  return new NextResponse(upstream.body, { headers });
}
