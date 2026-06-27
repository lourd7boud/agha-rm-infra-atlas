/**
 * Force dossier extraction for a specific tender id, with OCR enabled, even
 * when an existing extraction is present. Used to backfill rows whose first
 * extraction failed because we lacked OCR + DOCX support.
 *
 *   DATABASE_URL=... OPENROUTER_API_KEY=... \
 *     tsx apps/core/scripts/extract-dossier-by-id.ts <uuid> [<uuid>...]
 */
import { createLlmClientFromEnv } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { DossierExtractionService } from '../src/modules/tender/dossier-extraction.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const ids = process.argv.slice(2).filter((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (ids.length === 0) {
    console.error('usage: extract-dossier-by-id.ts <uuid> [<uuid>...]');
    process.exit(2);
  }
  const llm = createLlmClientFromEnv();
  if (!llm) {
    console.error('No LLM provider configured.');
    process.exit(2);
  }
  const repository = new DrizzleTenderRepository(getDb(databaseUrl));
  const service = new DossierExtractionService(repository, llm);
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const r = await service.extractTender(id, { force: true });
      const dur = Math.round((Date.now() - t0) / 1000);
      console.log(
        JSON.stringify({
          id,
          ok: true,
          tookSec: dur,
          extracted: r.extracted,
          estimationMad: r.estimationMad,
          cautionProvisoireMad: r.cautionProvisoireMad,
          qualifications: r.qualifications,
          bpu: r.bpuCount,
          sourceFiles: r.files,
        }),
      );
    } catch (e) {
      const dur = Math.round((Date.now() - t0) / 1000);
      console.error(
        JSON.stringify({ id, ok: false, tookSec: dur, error: (e as Error).message }),
      );
    }
  }
  process.exit(0);
}
main().catch((err: unknown) => {
  console.error('failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
