import { NextResponse, type NextRequest } from 'next/server';
import { getOfficeFile } from '@/lib/office-cache';

/**
 * PUBLIC, token-gated DCE file stream. The Microsoft Office Online viewer
 * (view.officeapps.live.com) fetches this from Microsoft's servers — no session
 * cookie — so it is exempted from auth (see middleware) and authorised solely by
 * the one-time `t` token minted by the authenticated /files/office-embed route.
 * The token is short-lived and the file is a public tender document.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('t');
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 });

  const file = getOfficeFile(token);
  if (!file) return NextResponse.json({ error: 'Lien expiré' }, { status: 404 });

  const body = new Uint8Array(file.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${file.filename}"`,
      // Microsoft's renderer fetches cross-origin; allow it.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
