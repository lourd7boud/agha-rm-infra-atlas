/**
 * One-off full-coverage deep crawl of the PMMP "en cours" catalogue
 * (marchespublics.gov.ma / Atexo MPE), mirroring datao's complete coverage.
 *
 * The scheduled Sentinel is page-capped for politeness (WATCH_MAX_PAGES); this
 * script walks the *entire* paginated result set in one pass so that:
 *   - every currently-open consultation is ingested (datao-parity coverage), and
 *   - every legacy row that predates canonical sourceUrl capture gets its NULL
 *     source_url healed in place (WatchService self-heals on duplicate).
 *
 * Stage-2 (detail) and stage-3 (vision) crawls are intentionally NOT wired here
 * — this pass is listing-only, so it is fast, cheap and safe to re-run. Both
 * insert and backfill are idempotent.
 *
 *   DATABASE_URL=... WATCH_PMMP_URL=... \
 *     tsx apps/core/scripts/crawl-full-once.ts [--pages=600] [--delay=1200]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { PradoPortalSource } from '../src/modules/watch/watch.source';
import { WatchService } from '../src/modules/watch/watch.service';

function intArg(name: string, fallback: number, min: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split('=')[1]) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const url = process.env.WATCH_PMMP_URL;
  if (!databaseUrl || !url) {
    console.error('DATABASE_URL and WATCH_PMMP_URL are required.');
    process.exit(2);
  }

  // pages must be >= 1 (0/empty would silently clamp to 1 in WatchService and
  // mislead the log below); delay may be 0 (valid politeness override).
  const maxPages = intArg('pages', 600, 1);
  const delayMs = intArg('delay', 1200, 0);

  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const source = new PradoPortalSource(url);
  // (source, tenders, snapshots, options, detailCrawler, resultCrawler)
  const service = new WatchService(source, repo, null, { maxPages, delayMs }, null, null);

  console.log(
    `crawl-full-once: walking up to ${maxPages} pages of ${url} (delay ${delayMs}ms)`,
  );
  const before = (await repo.findAll()).length;
  const summary = await service.runOnce();
  const after = (await repo.findAll()).length;

  console.log(`SUMMARY ${JSON.stringify(summary)}`);
  console.log(`catalogue size: ${before} -> ${after} (+${after - before})`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('full crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
