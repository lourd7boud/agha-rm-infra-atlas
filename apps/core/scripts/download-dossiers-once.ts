/**
 * One-off / cron-able bulk DCE dossier download (datao-style "Télécharger").
 * For each active tender that has a portal sourceUrl and no cached dossier yet,
 * runs the autonomous 4-step retrait and stores the ZIP in MinIO. Idempotent:
 * already-cached tenders are skipped, so it is safe to re-run until the
 * catalogue is fully covered.
 *
 *   DATABASE_URL=... S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
 *     [PORTAL_DCE_EMAIL=...] tsx apps/core/scripts/download-dossiers-once.ts [--limit=20]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { S3ObjectStorage } from '../src/modules/vault/storage';
import { DossierService } from '../src/modules/tender/dossier.service';
import { parsePortalRef } from '../src/modules/watch/dossier.crawler';

const POLITE_DELAY_MS = 1500;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.VAULT_BUCKET ?? 'atlas-vault';
  if (!databaseUrl || !endpoint || !accessKey || !secretKey) {
    console.error('DATABASE_URL and S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY are required.');
    process.exit(2);
  }
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 20;

  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const storage = new S3ObjectStorage(bucket, { endpoint, accessKey, secretKey });
  await storage.ensureBucket();
  const service = new DossierService(repo, storage);

  const now = Date.now();
  const all = await repo.findAll();
  const pending = all
    .filter((t) => parsePortalRef(t.sourceUrl))
    .filter((t) => t.deadlineAt.getTime() >= now)
    .filter((t) => !(t.raw as Record<string, unknown> | null)?.dossier)
    .slice(0, Math.max(0, Math.floor(limit)));

  console.log(`download-dossiers-once: ${pending.length} candidate(s) (limit ${limit})`);
  let ok = 0;
  let ko = 0;
  for (const t of pending) {
    try {
      const r = await service.ensureDossier(t.id);
      console.log(`OK ${t.reference} → ${r.filename} (${r.sizeBytes} bytes)`);
      ok += 1;
    } catch (error) {
      console.warn(`KO ${t.reference}: ${error instanceof Error ? error.message : error}`);
      ko += 1;
    }
    await new Promise((res) => setTimeout(res, POLITE_DELAY_MS));
  }
  console.log(`SUMMARY processed=${pending.length} ok=${ok} ko=${ko}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('dossier download failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
