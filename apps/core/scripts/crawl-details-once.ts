/**
 * One-off live trigger for the stage-2 detail crawl (verification / manual run).
 * Fetches the listing, walks the consultation detail pages, and enriches the
 * matching stored tenders (caution provisoire, category, detail URL; estimation
 * when published). Polite + bounded.
 *
 *   WATCH_PMMP_URL=... DATABASE_URL=... tsx apps/core/scripts/crawl-details-once.ts [--max=20]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { crawlDetails } from '../src/modules/watch/detail.crawler';

const UA = 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)';
const TIMEOUT = 30_000;

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const url = process.env.WATCH_PMMP_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!url || !databaseUrl) {
    console.error('WATCH_PMMP_URL and DATABASE_URL are required.');
    process.exit(2);
  }
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxDetails = maxArg ? Number(maxArg.split('=')[1]) : 20;

  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const listingHtml = await getHtml(url);
  const tenders = await repo.findAll();
  console.log(`listing=${listingHtml.length}b tenders=${tenders.length} maxDetails=${maxDetails}`);

  const summary = await crawlDetails(
    listingHtml,
    url,
    {
      fetchDetail: getHtml,
      tenders,
      applyEnrichment: async (id, amounts, detailMeta) => {
        await repo.updateEnrichment(id, amounts, { detail: detailMeta });
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date().toISOString(),
    },
    { maxDetails, delayMs: 1000 },
  );

  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
