import { NextResponse, type NextRequest } from 'next/server';
import { unzipSync } from 'fflate';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** Streams ONE document out of a tender's DCE ZIP, with the right content-type
 *  so the browser/viewer can render it inline (PDF in an iframe, image in an
 *  <img>, spreadsheet/word bytes parsed client-side). `?name=` is the exact zip
 *  entry path from the /files listing. */

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ error: 'name requis' }, { status: 400 });
  }
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
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
  const meta = (await metaRes.json()) as { url: string };

  const zipRes = await fetch(meta.url, { cache: 'no-store' });
  if (!zipRes.ok) {
    return NextResponse.json({ error: 'ZIP indisponible' }, { status: 502 });
  }
  const zipBytes = new Uint8Array(await zipRes.arrayBuffer());

  let entry: Uint8Array | undefined;
  try {
    const entries = unzipSync(zipBytes, { filter: (f) => f.name === name });
    entry = entries[name];
  } catch {
    return NextResponse.json({ error: 'ZIP illisible' }, { status: 502 });
  }
  if (!entry) {
    return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME[ext] ?? 'application/octet-stream';
  const label = (name.split('/').pop() || name).replace(/"/g, '');
  const body = new Uint8Array(entry);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${label}"`,
      'Cache-Control': 'private, max-age=600',
    },
  });
}
