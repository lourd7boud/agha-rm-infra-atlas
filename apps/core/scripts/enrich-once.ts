/**
 * One-off bulk AI enrichment of the active tender catalogue (datao-style fill).
 * Reads each unenriched, still-open tender with the fast OpenRouter model and
 * stores secteur / résumé / FAQ / lots / conditions in raw.aiEnrichment.
 * Idempotent: already-enriched tenders are skipped, so it is safe to re-run
 * (and to schedule) until the catalogue is fully covered.
 *
 *   DATABASE_URL=... OPENROUTER_API_KEY=... [OPENROUTER_MODEL=...] \
 *     tsx apps/core/scripts/enrich-once.ts [--limit=100]
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
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;

  const llm = createLlmClientFromEnv();
  if (!llm) {
    console.error('No LLM provider configured.');
    process.exit(2);
  }
  const repository = new DrizzleTenderRepository(getDb(databaseUrl));
  const service = new EnrichmentService(repository, llm);

  console.log(`enrich-once: provider=${process.env.LLM_PROVIDER ?? 'openrouter'} limit=${limit} …`);
  const summary = await service.aiEnrichBatch(limit, { onlyActive: true });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(summary.failed > 0 && summary.succeeded === 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('enrichment failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
