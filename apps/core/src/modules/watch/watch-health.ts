import type { WatchRunSummary } from './watch.service';

type Coverage = { lastParseOk: boolean | null; lastSuccessAt: Date | null; lastFetchAt: Date | null };

export function buildWatchHealth(coverage: Coverage | null, run: Pick<WatchRunSummary, 'status'> | null, now = new Date()) {
  const lastSuccessAt = coverage?.lastSuccessAt ?? null;
  const stale = !lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > 6 * 60 * 60_000;
  const state = run?.status === 'blocked' ? 'blocked' : run?.status === 'failed' ? 'failed'
    : !coverage ? 'unknown' : stale ? 'stale' : coverage.lastParseOk === false ? 'failed'
      : run?.status === 'complete' ? 'ready' : 'partial';
  return { state, lastSuccessAt, lastFetchAt: coverage?.lastFetchAt ?? null, stale };
}

export function nextScanDelay(status: WatchRunSummary['status'], requested: number): number {
  const minimum = status === 'blocked' ? 30 * 60_000 : status === 'failed' ? 15 * 60_000
    : status === 'partial' ? 5 * 60_000 : 60_000;
  return Math.max(minimum, Number.isFinite(requested) ? requested : minimum);
}
