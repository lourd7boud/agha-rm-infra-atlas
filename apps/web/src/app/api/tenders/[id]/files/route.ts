import { NextResponse, type NextRequest } from 'next/server';
import { unzipSync } from 'fflate';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** datao's "Voir le fichier source": lists the documents inside a tender's DCE
 *  ZIP so the drawer can open any of them inline. Reuses the core /dossier
 *  endpoint (which lazily retrieves + caches the ZIP in MinIO), fetches the ZIP
 *  server-side, and returns the entry list classified by viewer kind. */

type FileKind = 'pdf' | 'excel' | 'word' | 'image' | 'other';

function kindOf(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm' || ext === 'csv') return 'excel';
  if (ext === 'doc' || ext === 'docx' || ext === 'rtf') return 'word';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp'].includes(ext)) return 'image';
  return 'other';
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

  const zipRes = await fetch(meta.url, { cache: 'no-store' });
  if (!zipRes.ok) {
    return NextResponse.json({ error: 'ZIP indisponible' }, { status: 502 });
  }
  const zipBytes = new Uint8Array(await zipRes.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter: (f) => !f.name.endsWith('/') && f.originalSize > 0,
    });
  } catch {
    return NextResponse.json({ error: 'ZIP illisible' }, { status: 502 });
  }

  const files = Object.entries(entries)
    .map(([name, bytes]) => ({
      name,
      label: name.split('/').pop() || name,
      kind: kindOf(name),
      sizeBytes: bytes.length,
    }))
    .sort((a, b) => priority(a.name) - priority(b.name) || a.label.localeCompare(b.label));

  return NextResponse.json({ filename: meta.filename, files });
}
