// BFF de fichiers chantier (photos / PV / documents) — MinIO n'est pas exposé
// publiquement, ce handler porte le bearer token et relaie le flux binaire.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const { projectId, assetId } = await params;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(assetId)) {
    return NextResponse.json({ error: 'Identifiants invalides' }, { status: 400 });
  }
  const upstream = await fetch(
    `${API_URL}/btp/projects/${projectId}/assets/${assetId}/download`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Fichier indisponible (HTTP ${upstream.status})` },
      { status: upstream.status },
    );
  }
  const headers: Record<string, string> = {
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
    // Les fichiers sont immuables (clé UUID) — cache privé long pour la grille photos.
    'Cache-Control': 'private, max-age=3600',
  };
  const disposition = upstream.headers.get('Content-Disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  const length = upstream.headers.get('Content-Length');
  if (length) headers['Content-Length'] = length;
  return new NextResponse(upstream.body, { headers });
}
