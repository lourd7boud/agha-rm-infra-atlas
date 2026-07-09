// BFF de téléchargement Excel — le navigateur ne porte pas le bearer token de
// Core, ce handler le fait à sa place et relaie le flux xlsx tel quel.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

const KIND_PATHS: Record<string, (projectId: string, query: URLSearchParams) => string | null> = {
  bordereau: (projectId) => `/btp/projects/${projectId}/export/bordereau`,
  attachement: (projectId, query) => {
    const periodeId = query.get('periodeId');
    return `/btp/projects/${projectId}/export/attachement${periodeId ? `?periodeId=${periodeId}` : ''}`;
  },
  recapitulatif: (projectId) => `/btp/projects/${projectId}/export/recapitulatif`,
  decompte: (projectId, query) => {
    const decompteId = query.get('decompteId');
    if (!decompteId) return null;
    return `/btp/projects/${projectId}/export/decomptes/${decompteId}`;
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; kind: string }> },
) {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const { projectId, kind } = await params;
  const buildPath = KIND_PATHS[kind];
  const path = buildPath?.(projectId, request.nextUrl.searchParams) ?? null;
  if (!path) {
    return NextResponse.json({ error: `Export inconnu: ${kind}` }, { status: 400 });
  }
  const upstream = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Export indisponible (HTTP ${upstream.status})` },
      { status: upstream.status },
    );
  }
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        upstream.headers.get('Content-Disposition') ?? `attachment; filename="${kind}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
