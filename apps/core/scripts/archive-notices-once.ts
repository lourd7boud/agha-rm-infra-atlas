/**
 * Notice-archive backfill runner — the ACQUISITION half of the historical
 * result harvest (network + OCR only, ZERO LLM cost — runs at full speed
 * regardless of the daily budget). Resumable: id_avis dedupe makes re-walked
 * pages free. Run detached for the big sweeps:
 *
 *   DATABASE_URL=... tsx apps/core/scripts/archive-notices-once.ts \
 *     [--type=5] [--max=1000] [--pages=100] [--concurrency=3] [--delay=900]
 *
 * type 4 = résultat définitif (~35 616 on the portal)
 * type 5 = extrait de PV (~93 754 — every bidder + the estimation: the gold)
 */
import { getDb } from '../src/db/client';
import { DrizzleNoticeRepository } from '../src/modules/intel/notice.repository';
import { NoticeArchiveService } from '../src/modules/watch/notice-archive';

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
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const annonceType = typeArg?.split('=')[1] === '4' ? '4' : '5';

  const notices = new DrizzleNoticeRepository(getDb(databaseUrl));
  const service = new NoticeArchiveService(notices);

  const summary = await service.acquireOnce({
    annonceType,
    maxNotices: intArg('max', 500),
    maxPages: intArg('pages', 60),
    ocrConcurrency: intArg('concurrency', 3),
    delayMs: intArg('delay', 900),
  });
  console.log('SUMMARY ' + JSON.stringify(summary));
  console.log('ARCHIVE ' + JSON.stringify(await notices.countsByStatus()));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('archive failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
