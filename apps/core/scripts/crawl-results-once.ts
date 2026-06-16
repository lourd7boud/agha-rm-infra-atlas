/**
 * One-off live trigger for the stage-3 result crawl (verification / manual run).
 * Submits the result search, reads each scanned "avis de résultat définitif"
 * with the vision LLM, and stores the winner + amount in the competitor map.
 *
 *   DATABASE_URL=... LLM_API_KEY=... LLM_API_BASE=... \
 *     tsx apps/core/scripts/crawl-results-once.ts [--max=5]
 */
import { AnthropicLlmClient } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { ResultCrawlerService } from '../src/modules/watch/result.crawler';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!databaseUrl || !apiKey) {
    console.error('DATABASE_URL and LLM_API_KEY are required.');
    process.exit(2);
  }
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxResults = maxArg ? Number(maxArg.split('=')[1]) : 5;

  const llm = new AnthropicLlmClient({
    apiKey,
    baseUrl: process.env.LLM_API_BASE,
    tierModels: process.env.LLM_MODEL_T2 ? { T2: process.env.LLM_MODEL_T2 } : {},
  });
  const intel = new DrizzleIntelRepository(getDb(databaseUrl));
  const service = new ResultCrawlerService(llm, intel);

  const summary = await service.crawlOnce({ maxResults });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('result crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
