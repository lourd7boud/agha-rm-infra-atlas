/**
 * One-off bulk DCE dossier extraction (datao-grade fill). For each active tender
 * with a sourceUrl and no extraction yet, downloads the dossier in memory, reads
 * the RC/CPS/BPU text and has the fast OpenRouter model pull the REAL budget,
 * cautions, qualifications and BPU into the columns + raw.dossierExtraction.
 * Idempotent (already-extracted tenders are skipped) and disk-safe (no zip is
 * cached locally), so it is safe to re-run and schedule until the catalogue is
 * covered.
 *
 *   DATABASE_URL=... OPENROUTER_API_KEY=... [OPENROUTER_MODEL=...] PORTAL_DCE_*=... \
 *     tsx apps/core/scripts/extract-dossiers-once.ts [--limit=25] [--all] [--force]
 */
import { OpenRouterLlmClient } from '../src/modules/brain/llm.client';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';
import { DossierExtractionService } from '../src/modules/tender/dossier-extraction.service';

function intArg(name: string, fallback: number, min: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split('=')[1]) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!databaseUrl || !apiKey) {
    console.error('DATABASE_URL and OPENROUTER_API_KEY are required.');
    process.exit(2);
  }
  const limit = intArg('limit', 25, 1);
  const onlyActive = !process.argv.includes('--all');
  const force = process.argv.includes('--force');
  // --upgrade: also re-extract rows whose stored extraction predates the
  //   datao-form fields (contact/conditionsLegales/autres).
  // --order=oldest: drain from the historical end (a 2nd worker uses this while
  //   the server stays newest-first, so they converge without clashing).
  const upgrade = process.argv.includes('--upgrade');
  const order: 'newest' | 'oldest' = process.argv.includes('--order=oldest')
    ? 'oldest'
    : 'newest';
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';

  const llm = new OpenRouterLlmClient({
    apiKey,
    baseUrl: process.env.OPENROUTER_API_BASE,
    tierModels: { T1: model, T2: model, T3: model },
    appTitle: 'ATLAS - AGHA RM INFRA',
  });
  const repository = new DrizzleTenderRepository(getDb(databaseUrl));
  const service = new DossierExtractionService(repository, llm);

  console.log(
    `extract-dossiers-once: model=${model} limit=${limit} onlyActive=${onlyActive} force=${force} upgrade=${upgrade} order=${order} …`,
  );
  const summary = await service.extractBatch(limit, { onlyActive, force, upgrade, order });
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(summary.failed > 0 && summary.succeeded === 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('dossier extraction failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
