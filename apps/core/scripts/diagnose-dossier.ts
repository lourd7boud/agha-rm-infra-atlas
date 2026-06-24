/**
 * Diagnostic: for given tender ids, download the DCE from the portal and report
 * exactly what's inside — each file's name, byte size, and extracted text
 * length (PDF text-layer + OCR fallback) — so we can see WHERE extraction
 * breaks (download empty? zip empty? scanned PDF? OCR failing?).
 *
 *   DATABASE_URL=... tsx apps/core/scripts/diagnose-dossier.ts <uuid> [<uuid>...]
 */
import { unzipSync } from 'fflate';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import {
  dceIdentityFromEnv,
  downloadDce,
  parsePortalRef,
} from '../src/modules/watch/dossier.crawler';
import { extractDossierText } from '../src/modules/tender/dossier-text';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL required');
    process.exit(2);
  }
  const ids = process.argv.slice(2).filter((a) => /^[0-9a-f-]{36}$/i.test(a));
  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  for (const id of ids) {
    const t = await repo.findById(id);
    if (!t) {
      console.log(JSON.stringify({ id, error: 'not found' }));
      continue;
    }
    const ref = parsePortalRef(t.sourceUrl ?? '');
    if (!ref) {
      console.log(
        JSON.stringify({ id, ref: t.reference, error: 'no portal ref', sourceUrl: t.sourceUrl }),
      );
      continue;
    }
    try {
      const t0 = Date.now();
      const dossier = await downloadDce(ref, dceIdentityFromEnv());
      const dlSec = Math.round((Date.now() - t0) / 1000);
      let entries: Record<string, Uint8Array> = {};
      try {
        entries = unzipSync(dossier.bytes);
      } catch (e) {
        console.log(
          JSON.stringify({
            id,
            ref: t.reference,
            zipError: (e as Error).message,
            zipBytes: dossier.bytes.length,
          }),
        );
        continue;
      }
      const fileList = Object.entries(entries).map(([name, b]) => ({
        name,
        bytes: b.length,
      }));
      const tExtract = Date.now();
      const { text, files } = await extractDossierText(dossier.bytes);
      const extractSec = Math.round((Date.now() - tExtract) / 1000);
      console.log(
        JSON.stringify({
          id,
          ref: t.reference,
          dlSec,
          zipBytes: dossier.bytes.length,
          zipFilename: dossier.filename,
          rawEntries: fileList,
          extractSec,
          extractedTextLen: text.length,
          extractedFiles: files,
          sample: text.slice(0, 200),
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({ id, ref: t.reference, downloadError: (e as Error).message }),
      );
    }
  }
  process.exit(0);
}
main().catch((e: unknown) => {
  console.error('diagnose failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
