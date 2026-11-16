import { createHash } from 'node:crypto';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import {
  assertDossierArchiveSize,
  assertSelectedDossierEntry,
  createDossierMetadataBudget,
  MAX_DOSSIER_ARCHIVE_BYTES,
  trackDossierEntryMetadata,
} from './dossier-archive-safety';

export interface DceArchiveComparison {
  previousArchiveSha256: string;
  nextArchiveSha256: string;
  previousContentSha256: string;
  nextContentSha256: string;
  identicalArchives: boolean;
  identicalDocuments: boolean;
  added: string[];
  removed: string[];
  changed: string[];
}

interface FileFingerprint { size: number; sha256: string }

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** All metadata is checked before any document payload is allocated. */
function fingerprintArchive(bytes: Uint8Array) {
  try {
    assertDossierArchiveSize(bytes.byteLength);
    const metadata = createDossierMetadataBudget();
    const names = new Set<string>();
    const documents: UnzipFileInfo[] = [];
    let totalInflated = 0;
    unzipSync(bytes, { filter: file => {
      trackDossierEntryMetadata(file, metadata);
      assertSelectedDossierEntry(file);
      if (names.has(file.name) || ![0, 8].includes(file.compression)) throw new Error('Ambiguous ZIP entry');
      names.add(file.name);
      if (!file.name.endsWith('/')) {
        totalInflated += file.originalSize;
        if (totalInflated > MAX_DOSSIER_ARCHIVE_BYTES) throw new Error('ZIP inflation limit');
        documents.push({ ...file });
      }
      return false;
    } });
    if (documents.length === 0) throw new Error('No document entries');
    documents.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const entries = unzipSync(bytes, { filter: file => !file.name.endsWith('/') });
    const files = new Map<string, FileFingerprint>();
    for (const document of documents) {
      if (!Object.hasOwn(entries, document.name)) throw new Error('Missing ZIP entry');
      const content = entries[document.name]!;
      if (content.byteLength !== document.originalSize) throw new Error('Inconsistent ZIP payload size');
      files.set(document.name, { size: content.byteLength, sha256: sha256(content) });
    }
    // JSON framing preserves exact names and avoids delimiter ambiguities.
    const manifest = [...files].map(([name, file]) => [name, file.size, file.sha256]);
    return { archiveSha256: sha256(bytes), contentSha256: sha256(JSON.stringify(manifest)), files };
  } catch {
    // Do not expose parser diagnostics or document names in a failed response.
    throw new Error('Archive DCE invalide ou limites de traitement dépassées');
  }
}

/** Content equality ignores ZIP order, timestamps and compression choices. */
export function compareDceArchives(previous: Uint8Array, next: Uint8Array): DceArchiveComparison {
  const before = fingerprintArchive(previous);
  const after = fingerprintArchive(next);
  return {
    previousArchiveSha256: before.archiveSha256,
    nextArchiveSha256: after.archiveSha256,
    previousContentSha256: before.contentSha256,
    nextContentSha256: after.contentSha256,
    identicalArchives: before.archiveSha256 === after.archiveSha256,
    identicalDocuments: before.contentSha256 === after.contentSha256,
    added: [...after.files.keys()].filter(name => !before.files.has(name)),
    removed: [...before.files.keys()].filter(name => !after.files.has(name)),
    changed: [...before.files.keys()].filter(name => {
      const updated = after.files.get(name);
      const original = before.files.get(name)!;
      return updated !== undefined && (updated.size !== original.size || updated.sha256 !== original.sha256);
    }),
  };
}
