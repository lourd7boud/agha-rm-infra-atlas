import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const PRIVATE = { 'Cache-Control': 'private, no-store' };

/** Explicit, authenticated local OCR of a saved PDF. Never starts on a GET. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE });
  }
  const { id } = await context.params;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400, headers: PRIVATE });
  try {
    const upstream = await fetch(`${API_URL}/tender/tenders/${encodeURIComponent(id)}/dossier/file-ocr?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store', signal: AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return NextResponse.json({ error: 'Lecture OCR indisponible' }, { status: upstream.status, headers: PRIVATE });
    }
    return NextResponse.json(await upstream.json(), { headers: PRIVATE });
  } catch {
    return NextResponse.json({ error: 'Lecture OCR indisponible' }, { status: 503, headers: PRIVATE });
  }
}
