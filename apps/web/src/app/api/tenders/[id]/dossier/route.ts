import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Télécharger le dossier — proxies the core dossier endpoint (which lazily
 * retrieves the DCE ZIP from the portal and caches it in MinIO) and streams the
 * file to the browser. MinIO is on the internal network, so the presigned URL
 * is fetched server-side here rather than redirected to the client.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const metaRes = await fetch(`${API_URL}/tender/tenders/${id}/dossier`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  if (!metaRes.ok) {
    return NextResponse.json(
      { error: `Dossier indisponible (HTTP ${metaRes.status})` },
      { status: metaRes.status },
    );
  }
  const meta = (await metaRes.json()) as { url: string; filename: string };

  const fileRes = await fetch(meta.url, { cache: 'no-store' });
  if (!fileRes.ok || !fileRes.body) {
    return NextResponse.json(
      { error: 'Téléchargement du dossier échoué' },
      { status: 502 },
    );
  }
  const safeName = meta.filename.replace(/["\r\n]/g, '');
  return new NextResponse(fileRes.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
