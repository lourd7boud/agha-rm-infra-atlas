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
import { OpenRouterLlmClient } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { EnrichmentService } from '../src/modules/tender/enrichment.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!databaseUrl || !apiKey) {
    console.error('DATABASE_URL and OPENROUTER_API_KEY are required.');
    process.exit(2);
  }
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';

  const llm = new OpenRouterLlmClient({
    apiKey,
    baseUrl: process.env.OPENROUTER_API_BASE,
    tierModels: { T1: model, T2: model, T3: model },
    appTitle: 'ATLAS - AGHA RM INFRA',
  });
  const repository = new DrizzleTenderRepository(getDb(databaseUrl));
  const service = new EnrichmentService(repository, llm);

  console.log(`enrich-once: model=${model} limit=${limit} …`);
  const summary = await service.aiEnrichBatch(limit, { onlyActive: true });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(summary.failed > 0 && summary.succeeded === 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('enrichment failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
