/**
 * One-off live trigger for the stage-3b PV crawl (extrait de procès-verbal,
 * annonceType=5). Submits the search, vision-reads each scanned PV, and upserts
 * EVERY soumissionnaire (winner + écartés) with the administrative estimation —
 * filling the rebate calibration and the competitor database.
 *
 *   DATABASE_URL=... LLM_PROVIDER=... LLM_API_KEY=... \
 *     tsx apps/core/scripts/crawl-pv-once.ts [--max=5] [--pages=1]
 */
import { createLlmClientFromEnv } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { ExtraitPvCrawlerService } from '../src/modules/watch/pv.crawler';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxPv = maxArg ? Number(maxArg.split('=')[1]) : 5;
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
  const service = new ExtraitPvCrawlerService(llm, intel);

  const summary = await service.crawlOnce({ maxPv, maxPages });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pv crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
