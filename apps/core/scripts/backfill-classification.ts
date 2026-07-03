/**
 * One-off backfill for the denormalized classification columns added in
 * migration 0033 (region / ville / category / secteur / lot_count / has_bpu).
 *
 * Classification is JS (regex classifiers in inventory.domain), so it cannot run
 * inside the SQL migration. This runner reads each tender's buyerName/objet/
 * location/raw, computes the six fields with the SAME classifiers the write path
 * and the read fallback use (no drift), and UPDATEs the row in batches. Safe to
 * re-run: it recomputes deterministically and overwrites whatever is there.
 *
 * The read path already falls back to on-the-fly inference for any row whose
 * column is still NULL, so the app is correct before AND during this backfill —
 * running it just moves the classification off the hot path onto the write path.
 *
 *   DATABASE_URL=... tsx apps/core/scripts/backfill-classification.ts [--batch=500]
 */
import { asc, gt, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { tenders } from '../src/db/schema';
import { classifyForStorage } from '../src/modules/tender/inventory.domain';
import { readDossierExtraction } from '../src/modules/tender/dossier-extraction';

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
  const batchSize = intArg('batch', 500);
  const db = getDb(databaseUrl);

  // Keyset pagination by id (stable, index-friendly) so the backfill streams the
  // whole catalogue without holding it all in memory or re-scanning.
  let cursor = '00000000-0000-0000-0000-000000000000';
  let processed = 0;
  for (;;) {
    const rows = await db
      .select({
        id: tenders.id,
        buyerName: tenders.buyerName,
        objet: tenders.objet,
        location: tenders.location,
        raw: tenders.raw,
      })
      .from(tenders)
      .where(gt(tenders.id, cursor))
      .orderBy(asc(tenders.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const classified = classifyForStorage({
        buyerName: row.buyerName,
        objet: row.objet,
        location: row.location,
      });
      const dossier = readDossierExtraction(
        row.raw as Record<string, unknown> | null,
      );
      const hasBpu = dossier ? dossier.bpu.length > 0 : false;
      await db
        .update(tenders)
        .set({
          region: classified.region,
          ville: classified.ville,
          category: classified.category,
          secteur: classified.secteur,
          lotCount: classified.lotCount,
          hasBpu,
          // Do NOT bump updated_at: the backfill is a derived recompute, not a
          // content change — bumping it would make every row look "fresh" to the
          // /tender/inventory ?since= live poll and flood every open tab.
        })
        .where(sql`${tenders.id} = ${row.id}`);
    }

    processed += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`backfilled ${processed} tenders (cursor=${cursor})`);
  }

  console.log(`SUMMARY ${JSON.stringify({ processed })}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    'classification backfill failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
