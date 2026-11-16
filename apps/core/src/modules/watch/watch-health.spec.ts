import { describe, expect, test } from 'vitest';
import { buildWatchHealth, nextScanDelay } from './watch-health';

describe('radar health', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  test('never reports an unobserved source as healthy', () => {
    expect(buildWatchHealth(null, null, now).state).toBe('unknown');
  });
  test('reports stale data even if the last page parsed correctly', () => {
    expect(buildWatchHealth({ lastParseOk: true, lastSuccessAt: new Date('2026-10-21'), lastFetchAt: now }, null, now).state).toBe('stale');
  });
  test('keeps a failed current run visible despite older successful snapshots', () => {
    expect(buildWatchHealth({ lastParseOk: true, lastSuccessAt: now, lastFetchAt: now }, { status: 'blocked' }, now).state).toBe('blocked');
  });
  test('backs off failures and blocks instead of repeating every five seconds', () => {
    expect(nextScanDelay('complete', 5000)).toBe(60_000);
    expect(nextScanDelay('failed', 5000)).toBe(900_000);
    expect(nextScanDelay('blocked', 5000)).toBe(1_800_000);
  });
});
