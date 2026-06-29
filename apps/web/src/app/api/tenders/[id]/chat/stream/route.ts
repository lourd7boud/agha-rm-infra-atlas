import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Per-tender AI chat -- STREAMING proxy. Forwards the question + bounded history
 * to the core POST /tender/tenders/:id/chat/stream endpoint (text/event-stream)
 * with the Keycloak bearer attached, and pipes the SSE bytes straight to the
 * browser. The chat panel parses data: {type:"delta",text:"..."} chunks and
 * renders token-by-token (datao-grade UX). When the upstream returns a non-2xx
 * code BEFORE the first SSE byte (auth/validation/quota), we surface it as
 * plain JSON so the chat UI can show a clean error instead of an empty stream.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
  }

  const body = await req.text();
  const upstream = await fetch(`${API_URL}/tender/tenders/${id}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body,
    cache: 'no-store',
    duplex: 'half',
  } as RequestInit);

  const upstreamCT = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !upstreamCT.includes('event-stream')) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstreamCT || 'application/json' },
    });
  }

  if (!upstream.body) {
    return NextResponse.json({ error: 'Stream amont vide' }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
