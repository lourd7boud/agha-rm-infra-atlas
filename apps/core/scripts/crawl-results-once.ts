/**
 * One-off live trigger for the stage-3 result crawl (verification / manual run).
 * Submits the result search, reads each scanned "avis de résultat définitif"
 * with the vision LLM, and stores the winner + amount in the competitor map.
 *
 *   DATABASE_URL=... LLM_PROVIDER=... LLM_API_KEY=... \
 *     tsx apps/core/scripts/crawl-results-once.ts [--max=5] [--pages=1]
 */
import { createLlmClientFromEnv } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { ResultCrawlerService } from '../src/modules/watch/result.crawler';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxResults = maxArg ? Number(maxArg.split('=')[1]) : 5;
  const pagesArg = process.argv.find((a) => a.startsWith('--pages='));
  const maxPages = pagesArg ? Number(pagesArg.split('=')[1]) : 1;

  // Provider-aware client (Google/OpenRouter/Anthropic) — the old direct
  // AnthropicLlmClient broke the moment prod switched to the Gemini gateway.
  const llm = createLlmClientFromEnv();
  if (!llm) {
    console.error(
      'No LLM configured — set LLM_PROVIDER + LLM_API_KEY (or OPENROUTER_API_KEY).',
    );
    process.exit(2);
  }
  const intel = new DrizzleIntelRepository(getDb(databaseUrl));
  const service = new ResultCrawlerService(llm, intel);

  const summary = await service.crawlOnce({ maxResults, maxPages });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('result crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
