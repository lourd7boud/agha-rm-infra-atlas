import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { fetchDceFile } from '@/lib/dce-zip';
import { putOfficeFile } from '@/lib/office-cache';

/**
 * Issues a Microsoft Office Online viewer URL for one DCE Office document
 * (Word/Excel) — datao's exact approach. The authenticated user's request pulls
 * the file bytes, stashes them under a one-time token, and returns an
 * view.officeapps.live.com embed URL pointing at our PUBLIC /api/public/dce
 * route (which Microsoft's servers fetch to render the file faithfully).
 */

const OFFICE_VIEWER = 'https://view.officeapps.live.com/op/embed.aspx?src=';

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

  const token = putOfficeFile(file.bytes, file.mime, file.label);
  // Public, internet-reachable URL Microsoft will fetch. Prefer the configured
  // public origin; fall back to the request origin.
  const origin = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || req.nextUrl.origin;
  const publicUrl = `${origin}/api/public/dce?t=${token}`;
  const embedUrl = OFFICE_VIEWER + encodeURIComponent(publicUrl);
  return NextResponse.json({ embedUrl });
}
