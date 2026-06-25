import { unzipSync } from 'fflate';

/**
 * Shared helper: pull ONE document's bytes out of a tender's DCE ZIP. The ZIP is
 * retrieved via the core /dossier endpoint (which caches it in MinIO) and
 * fetched server-side, then the named entry is inflated. Used by the
 * authenticated raw-stream route and the Office-embed token issuer.
 */

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

export const DCE_MIME: Record<string, string> = {
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

export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return DCE_MIME[ext] ?? 'application/octet-stream';
}

export interface DceFileBytes {
  bytes: Uint8Array;
  mime: string;
  label: string;
}

/** Returns the named DCE entry's bytes, or null if not found / unavailable. */
export async function fetchDceFile(
  tenderId: string,
  name: string,
  accessToken: string,
): Promise<DceFileBytes | null> {
  const metaRes = await fetch(`${API_URL}/tender/tenders/${tenderId}/dossier`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!metaRes.ok) return null;
  const meta = (await metaRes.json()) as { url: string };

  const zipRes = await fetch(meta.url, { cache: 'no-store' });
  if (!zipRes.ok) return null;
  const zipBytes = new Uint8Array(await zipRes.arrayBuffer());

  let entry: Uint8Array | undefined;
  try {
    const entries = unzipSync(zipBytes, { filter: (f) => f.name === name });
    entry = entries[name];
  } catch {
    return null;
  }
  if (!entry) return null;

  return {
    bytes: new Uint8Array(entry),
    mime: mimeForName(name),
    label: (name.split('/').pop() || name).replace(/"/g, ''),
  };
}
