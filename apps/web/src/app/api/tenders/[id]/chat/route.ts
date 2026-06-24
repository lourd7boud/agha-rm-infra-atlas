import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Per-tender AI chat proxy — forwards the question + bounded history to the core
 * `POST /tender/tenders/:id/chat` endpoint with the session bearer attached, and
 * returns the JSON answer. The browser never talks to core directly (auth lives
 * server-side); the request is single-flight on core (no streaming) and bounded
 * (~5s typical, 60s LLM timeout).
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

  const body = await req.text();
  const upstream = await fetch(`${API_URL}/tender/tenders/${id}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body,
    cache: 'no-store',
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
