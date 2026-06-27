/**
 * Force AI enrichment for a specific tender id — bypasses the batch ordering
 * so we can verify a single high-priority row (e.g. user-reported BOUDNIB).
 *
 *   DATABASE_URL=... OPENROUTER_API_KEY=... \
 *     tsx apps/core/scripts/enrich-by-id.ts <uuid> [<uuid>...]
 */
import { createLlmClientFromEnv } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { EnrichmentService } from '../src/modules/tender/enrichment.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const ids = process.argv.slice(2).filter((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (ids.length === 0) {
    console.error('usage: enrich-by-id.ts <uuid> [<uuid>...]');
    process.exit(2);
  }
  const llm = createLlmClientFromEnv();
  if (!llm) {
    console.error('No LLM provider configured.');
    process.exit(2);
  }
  const repository = new DrizzleTenderRepository(getDb(databaseUrl));
  const service = new EnrichmentService(repository, llm);
  for (const id of ids) {
    try {
      const r = await service.aiEnrichTender(id);
      console.log(
        JSON.stringify({
          id,
          secteur: r.aiEnrichment?.secteur,
          resume: (r.aiEnrichment?.resume ?? '').slice(0, 300),
          lots: r.aiEnrichment?.lots?.length ?? 0,
        }),
      );
    } catch (e) {
      console.error(`failed ${id}:`, (e as Error).message);
    }
  }
  process.exit(0);
}
main().catch((err: unknown) => {
  console.error('failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
