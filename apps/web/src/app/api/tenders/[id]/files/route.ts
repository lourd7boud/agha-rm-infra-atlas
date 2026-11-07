import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import type { DceFileKind } from '@/lib/dce-file-kind';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** Authenticated BFF for Core's metadata-only DCE listing. Core reads the ZIP
 * central directory without inflating every document. */

/** Junk entries that get zipped into DCEs but aren't real documents: Word/Excel
 *  owner-lock temp files (~$…), OS metadata, and hidden dotfiles. */
function isJunk(name: string): boolean {
  const base = name.split('/').pop() || name;
  if (base.startsWith('~$') || base.startsWith('.')) return true;
  // Office/system temp files: ~$RC.docx, ~WRL2103.tmp, *.tmp, Thumbs.db…
  if (/^~wrl/i.test(base) || /\.tmp$/i.test(base)) return true;
  if (/^(thumbs\.db|desktop\.ini)$/i.test(base)) return true;
  if (name.startsWith('__MACOSX/')) return true;
  return false;
}

function priority(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('bpu') || n.includes('bordereau') || n.includes('estimatif') || n.includes('bpde')) return 0;
  if (/(^|[^a-z])rc([^a-z]|$)|reglement|règlement/.test(n)) return 1;
  if (n.includes('cps') || n.includes('cct') || n.includes('ccap')) return 2;
  if (n.includes('avis')) return 3;
  return 4;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const metaRes = await fetch(`${API_URL}/tender/tenders/${encodeURIComponent(id)}/files`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  if (!metaRes.ok) {
    return NextResponse.json(
      { error: `Dossier indisponible (HTTP ${metaRes.status})` },
      { status: metaRes.status },
    );
  }
  const payload = (await metaRes.json()) as {
    files: Array<{
      name: string;
      label: string;
      kind: DceFileKind;
      sizeBytes: number;
    }>;
  };
  const files = payload.files
    .filter((file) => !isJunk(file.name))
    .sort((a, b) => priority(a.name) - priority(b.name) || a.label.localeCompare(b.label));

  return NextResponse.json({ files });
}
