import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

async function proxy(method: 'GET' | 'POST'): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Session expirée' }, { status: 401 });
  }
  try {
    const response = await fetch(`${API_URL}/watch/${method === 'GET' ? 'status' : 'run'}`, {
      method, headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    return new Response(await response.text(), {
      status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'État du radar indisponible' }, { status: 503 });
  }
}

export async function GET(): Promise<Response> { return proxy('GET'); }

export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Origine non autorisée' }, { status: 403 });
  }
  return proxy('POST');
}
