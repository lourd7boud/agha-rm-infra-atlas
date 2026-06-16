/**
 * One-off live trigger for the stage-3b PV crawl (extrait de procès-verbal,
 * annonceType=5). Submits the search, vision-reads each scanned PV, and upserts
 * EVERY soumissionnaire (winner + écartés) with the administrative estimation —
 * filling the rebate calibration and the competitor database.
 *
 *   DATABASE_URL=... LLM_API_KEY=... LLM_API_BASE=... \
 *     tsx apps/core/scripts/crawl-pv-once.ts [--max=5]
 */
import { AnthropicLlmClient } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { ExtraitPvCrawlerService } from '../src/modules/watch/pv.crawler';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!databaseUrl || !apiKey) {
    console.error('DATABASE_URL and LLM_API_KEY are required.');
    process.exit(2);
  }
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxPv = maxArg ? Number(maxArg.split('=')[1]) : 5;

  const llm = new AnthropicLlmClient({
    apiKey,
    baseUrl: process.env.LLM_API_BASE,
    tierModels: process.env.LLM_MODEL_T2 ? { T2: process.env.LLM_MODEL_T2 } : {},
  });
  const intel = new DrizzleIntelRepository(getDb(databaseUrl));
  const service = new ExtraitPvCrawlerService(llm, intel);

  const summary = await service.crawlOnce({ maxPv });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pv crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
