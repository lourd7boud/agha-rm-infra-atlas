/**
 * Notice-interpretation runner — turns archived OCR text into competitor
 * bids (deterministic regex first, LLM fallback). Budget-aware: a 402/5xx
 * stops the batch and leaves the rest 'acquired' for the next run.
 *
 *   DATABASE_URL=... LLM_PROVIDER=... LLM_API_KEY=... \
 *     tsx apps/core/scripts/interpret-notices-once.ts [--limit=200] [--type=4|5]
 */
import { getDb } from '../src/db/client';
import { createLlmClientFromEnv } from '../src/modules/brain/llm.client';
import { DrizzleIntelRepository } from '../src/modules/intel/intel.repository';
import { DrizzleNoticeRepository } from '../src/modules/intel/notice.repository';
import { NoticeInterpretService } from '../src/modules/watch/notice-interpret';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 200;
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const annonceType =
    typeArg?.split('=')[1] === '4' ? ('4' as const)
    : typeArg?.split('=')[1] === '5' ? ('5' as const)
    : undefined;

  const db = getDb(databaseUrl);
  const notices = new DrizzleNoticeRepository(db);
  const intel = new DrizzleIntelRepository(db);
  const llm = createLlmClientFromEnv();

  const service = new NoticeInterpretService(notices, intel, llm);
  const summary = await service.interpretOnce({
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200,
    ...(annonceType ? { annonceType } : {}),
  });
  console.log('SUMMARY ' + JSON.stringify(summary));
  console.log('ARCHIVE ' + JSON.stringify(await notices.countsByStatus()));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('interpret failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
