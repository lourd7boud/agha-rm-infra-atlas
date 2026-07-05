/**
 * One-off backlog harvest of "Suivre la commission" (SuiviConsultation) — reads
 * the STRUCTURED commission table (all soumissionnaires + amounts) for every
 * past-deadline consultation we hold and stores each as a competitor_bid. Zero
 * OCR / LLM. Idempotent: each row is stamped raw.suivi and leaves the work list.
 *
 *   DATABASE_URL=... tsx scripts/crawl-suivi-once.ts [--batch=300] [--delay=700] [--max-iter=1000]
 */
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { SuiviCrawlerService } from '../src/modules/watch/suivi.crawler';

function intArg(name: string, fallback: number, min: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split('=')[1]) : Number.NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

const MAX_CONSECUTIVE_STALLS = 3;

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const batch = intArg('batch', 300, 1);
  const delayMs = intArg('delay', 700, 0);
  const maxIter = intArg('max-iter', 1000, 1);

  const db = getDb(dbUrl);
  const svc = new SuiviCrawlerService(
    new DrizzleTenderRepository(db),
    new DrizzleIntelRepository(db),
  );

  console.log(`crawl-suivi-once: batch=${batch} delay=${delayMs}ms max-iter=${maxIter}`);
  let fetched = 0;
  let withBidders = 0;
  let bidsStored = 0;
  let errors = 0;
  let stalls = 0;
  let iter = 0;
  for (; iter < maxIter; iter += 1) {
    const s = await svc.crawlBacklog({ maxSuivi: batch, delayMs });
    fetched += s.fetched;
    withBidders += s.withBidders;
    bidsStored += s.bidsStored;
    errors += s.errors;
    console.log(
      `iter ${iter + 1}: ${JSON.stringify(s)} | cum fetched=${fetched} withBidders=${withBidders} bids=${bidsStored} errors=${errors}`,
    );
    if (s.targets === 0) {
      console.log('DRAINED — no past-deadline commission left to harvest.');
      break;
    }
    if (s.fetched === 0) {
      stalls += 1;
      if (stalls >= MAX_CONSECUTIVE_STALLS) {
        console.error(`ABORT — ${MAX_CONSECUTIVE_STALLS} consecutive no-fetch batches.`);
        break;
      }
    } else {
      stalls = 0;
    }
  }
  console.log(`DONE iters=${iter} fetched=${fetched} withBidders=${withBidders} bids=${bidsStored} errors=${errors}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('suivi harvest failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
