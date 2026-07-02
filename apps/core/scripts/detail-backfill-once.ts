/**
 * DB-driven detail backfill runner — fills the caution (+ catégorie, and the
 * estimation when published) for every stored tender still missing it, via
 * its canonical detail URL. Zero LLM; one attempt per row (raw.detail stamp).
 *
 *   DATABASE_URL=... tsx apps/core/scripts/detail-backfill-once.ts [--max=500] [--delay=800]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { DetailCrawlerService } from '../src/modules/watch/detail.crawler';
import { FixturePortalSource } from '../src/modules/watch/watch.source';

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split('=')[1]) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const tenders = new DrizzleTenderRepository(getDb(databaseUrl));
  // The backfill path never touches the listing source — a fixture stub
  // satisfies the constructor without any live dependency (read lazily,
  // only by crawlOnce, which this runner never calls).
  const service = new DetailCrawlerService(
    new FixturePortalSource(''),
    tenders,
  );
  const summary = await service.backfillMissing({
    maxDetails: intArg('max', 500),
    delayMs: intArg('delay', 800),
  });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('detail backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
