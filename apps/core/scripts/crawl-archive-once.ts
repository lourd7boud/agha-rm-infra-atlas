/**
 * One-off full-history deep crawl of the PMMP consultation ARCHIVE
 * (marchespublics.gov.ma / Atexo MPE) — datao-parity coverage of every
 * consultation ever published, not just the ~9 965 currently "en cours".
 *
 * Why this reaches the archive where crawl-full-once does not:
 *   • crawl-full-once walks `&AllCons&searchAnnCons` — the `&searchAnnCons`
 *     flag restricts the listing to open consultations (~9 965 rows).
 *   • Dropping `&searchAnnCons` → `&AllCons` alone exposes the WHOLE history:
 *     99 642 consultations back to 2017 (verified live). The advanced-search
 *     date fields do NOT filter this Atexo instance, so date-windowing is a
 *     dead end; plain deep pagination is the correct, complete mechanism.
 *   • At the portal default of 10 rows/page that is 9 965 pages. Setting the
 *     pager to 500/page (PradoPortalSource `pageSize`) collapses it to ~200
 *     pages — a few minutes of polite hops, one PRADO session cookie throughout.
 *
 * Listing-only (like crawl-full-once): stage-2/3 enrichment is intentionally NOT
 * wired here, so the pass is fast, cheap and idempotent (WatchService heals on
 * duplicate). Past-deadline rows classify as clôturé downstream by their
 * deadline. Follow up with `crawl-suivi-once.ts` to harvest the competitor
 * field of the newly-ingested clôturés.
 *
 *   DATABASE_URL=... \
 *     tsx apps/core/scripts/crawl-archive-once.ts \
 *       [--url=...] [--pages=210] [--pagesize=500] [--delay=1100]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { PradoPortalSource } from '../src/modules/watch/watch.source';
import { WatchService } from '../src/modules/watch/watch.service';

const DEFAULT_ARCHIVE_URL =
  'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons';

function intArg(name: string, fallback: number, min: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split('=')[1]) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function strArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = raw?.slice(`--${name}=`.length);
  return v && v.length > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }

  const url = strArg('url', process.env.WATCH_ARCHIVE_URL ?? DEFAULT_ARCHIVE_URL);
  // pages must be >= 1; the archive is ~200 pages at 500/page, 210 leaves slack.
  const maxPages = intArg('pages', 210, 1);
  // pagesize 0 disables the switch (falls back to the portal's 10/page).
  const pageSize = intArg('pagesize', 500, 0);
  // delay may be 0 (valid politeness override); default 1100ms per the crawlers.
  const delayMs = intArg('delay', 1100, 0);

  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const source = new PradoPortalSource(url, pageSize > 0 ? { pageSize } : {});
  // (source, tenders, snapshots, options, detailCrawler, resultCrawler)
  const service = new WatchService(source, repo, null, { maxPages, delayMs }, null, null);

  console.log(
    `crawl-archive-once: walking up to ${maxPages} pages of ${url} ` +
      `(pageSize ${pageSize || 'portal-default'}, delay ${delayMs}ms)`,
  );
  const before = (await repo.findAll()).length;
  const summary = await service.runOnce();
  const after = (await repo.findAll()).length;

  console.log(`SUMMARY ${JSON.stringify(summary)}`);
  console.log(`catalogue size: ${before} -> ${after} (+${after - before})`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('archive crawl failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
