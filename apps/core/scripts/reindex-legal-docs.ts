// One-off maintenance: OCR-extract + cache the text of every LEGAL document
// (/compta/legal coffre) so the AI agent can read SCANNED papers (attestations,
// CIN…), not just their titles. Idempotent — skips already-cached docs unless
// --force. Run inside the core container (it has the env + ocrmypdf/tesseract):
//   docker exec atlas-apps-core-1 sh -c "cd /app/apps/core && npx tsx scripts/reindex-legal-docs.ts"
import { getDb } from '../src/db/client';
import { DrizzleComptaRegistresRepository } from '../src/modules/compta/compta-registres.repository';
import { S3ObjectStorage } from '../src/modules/vault/storage';
import {
  extractAndCacheLegalDocText,
  legalDocTextCacheKey,
} from '../src/modules/tender/legal-doc-text';

async function readAll(body: AsyncIterable<Buffer | Uint8Array>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return new Uint8Array(Buffer.concat(chunks));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!url || !endpoint || !accessKey || !secretKey) {
    throw new Error('DATABASE_URL + S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY required');
  }
  const registres = new DrizzleComptaRegistresRepository(getDb(url));
  const storage = new S3ObjectStorage(process.env.VAULT_BUCKET ?? 'atlas-vault', {
    endpoint,
    accessKey,
    secretKey,
  });
  const force = process.argv.includes('--force');

  const docs = await registres.listDocuments();
  console.log(`Re-indexing ${docs.length} legal document(s) with OCR${force ? ' (force)' : ''}…`);
  let extracted = 0;
  let empty = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    if (!doc.storageKey) {
      skipped += 1;
      continue;
    }
    if (!force) {
      try {
        await storage.getObject(legalDocTextCacheKey(doc.id));
        console.log(`  · ${doc.titre} — déjà en cache`);
        skipped += 1;
        continue;
      } catch {
        // not cached — extract below
      }
    }
    try {
      const bytes = await readAll(
        (await storage.getObject(doc.storageKey)).body as AsyncIterable<Buffer | Uint8Array>,
      );
      const text = await extractAndCacheLegalDocText(
        storage,
        doc.id,
        bytes,
        doc.fileName ?? 'doc.pdf',
        true,
      );
      if (text) {
        extracted += 1;
        console.log(`  ✓ ${doc.titre} → ${text.length} chars`);
      } else {
        empty += 1;
        console.log(`  ∅ ${doc.titre} → vide (OCR n'a rien produit)`);
      }
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${doc.titre}: ${(e as Error).message}`);
    }
  }

  console.log(
    `Terminé: ${extracted} extraits, ${empty} vides, ${skipped} ignorés, ${failed} échecs.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
