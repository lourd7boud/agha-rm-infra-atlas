import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401, headers });
  }
  const { id } = await context.params;
  try {
    const response = await fetch(`${API_URL}/tender/tenders/${encodeURIComponent(id)}/dossier/decision-excerpts`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, cache: 'no-store',
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(25_000)]),
    });
    if (response.ok) return NextResponse.json(await response.json(), { headers });
    await response.body?.cancel();
    return NextResponse.json({ error: 'Extraits du DCE indisponibles' }, { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: 'Extraits du DCE indisponibles' }, { status: 503, headers });
  }
}
