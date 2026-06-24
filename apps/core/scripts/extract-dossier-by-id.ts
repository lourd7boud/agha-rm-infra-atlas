/**
 * Force dossier extraction for a specific tender id, with OCR enabled, even
 * when an existing extraction is present. Used to backfill rows whose first
 * extraction failed because we lacked OCR + DOCX support.
 *
 *   DATABASE_URL=... OPENROUTER_API_KEY=... \
 *     tsx apps/core/scripts/extract-dossier-by-id.ts <uuid> [<uuid>...]
 */
import { OpenRouterLlmClient } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { DossierExtractionService } from '../src/modules/tender/dossier-extraction.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!databaseUrl || !apiKey) {
    console.error('DATABASE_URL and OPENROUTER_API_KEY are required.');
    process.exit(2);
  }
  const ids = process.argv.slice(2).filter((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (ids.length === 0) {
    console.error('usage: extract-dossier-by-id.ts <uuid> [<uuid>...]');
    process.exit(2);
  }
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';
  const llm = new OpenRouterLlmClient({
    apiKey,
    baseUrl: process.env.OPENROUTER_API_BASE,
    tierModels: { T1: model, T2: model, T3: model },
    appTitle: 'ATLAS - AGHA RM INFRA',
  });
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
          estimationMad: r.extraction?.estimationMad ?? null,
          cautionProvisoireMad: r.extraction?.cautionProvisoireMad ?? null,
          qualifications: r.extraction?.qualifications?.length ?? 0,
          bpu: r.extraction?.bpu?.length ?? 0,
          sourceFiles: r.extraction?.sourceFiles ?? [],
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
