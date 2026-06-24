import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

async function bearer(): Promise<string | null> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') return null;
  return session.accessToken;
}

/** Delete a list (owner-only on the core side). */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const token = await bearer();
  if (!token) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const upstream = await fetch(`${API_URL}/tender/lists/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
