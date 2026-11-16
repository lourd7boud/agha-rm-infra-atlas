import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const importId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!importId.test(id)) return new Response(null, { status: 404 });
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return new Response(null, { status: 401 });
  }
  const upstream = await fetch(`${API_URL}/btp/revision/index-imports/${id}/file`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    signal: request.signal,
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="index-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
