import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/**
 * Agent AGHA-RM-INFRA DCE-extraction proxy — POST downloads the consultation's
 * DCE from the portal and extracts the real budget/caution/qualifications + the
 * bordereau (BPU) onto the tender, so the agent can analyse it precisely and
 * fill the BPU. Forwards to the core tender route. Can take ~10-60s (portal
 * download + one T1 LLM/vision call), so callers must not treat it as instant.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const upstream = await fetch(
    `${API_URL}/tender/tenders/${encodeURIComponent(id)}/extract-dossier`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
