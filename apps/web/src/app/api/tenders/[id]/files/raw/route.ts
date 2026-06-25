import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { fetchDceFile } from '@/lib/dce-zip';

/** Streams ONE document out of a tender's DCE ZIP (authenticated, same-origin)
 *  with the right content-type so the viewer renders it inline — PDF in an
 *  iframe, image in an <img>, or as a download. `?name=` is the exact zip entry
 *  path from the /files listing. Office files use /files/office-embed instead. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 });

  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const file = await fetchDceFile(id, name, session.accessToken);
  if (!file) return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });

  const body = new Uint8Array(file.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${file.label}"`,
      'Cache-Control': 'private, max-age=600',
    },
  });
}
