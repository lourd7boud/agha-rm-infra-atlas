import { expect, test, vi } from 'vitest';
import { WatchController } from './watch.module';
import { InMemorySnapshotRepository } from './snapshot.repository';
import { WatchAuditCapture } from './watch-audit';

test('provides retained identity evidence separately from the run summary', async () => {
  const capture = new WatchAuditCapture('https://portal/?token=not-for-output');
  capture.record({ page: 1, declared: 1, sourceRows: ['123/org'], parsed: ['123/org'], skippedRows: 0 });
  const job = { id: '1', processedOn: 1, finishedOn: 2, getState: async () => 'completed',
    returnvalue: { status: 'complete', audit: capture.finish() } };
  const queue = { getJob: async () => job };
  const controller = new WatchController(queue as never, new InMemorySnapshotRepository(), null as never, null as never, null as never);
  expect(await controller.getRun('1')).toMatchObject({ auditAvailable: true, result: { status: 'complete' } });
  expect((await controller.getRun('1')).result).not.toHaveProperty('audit');
  const audit = await controller.getRunAudit('1');
  expect(audit.audit.pages[0]?.sourceRows).toEqual(['123/org']);
  expect(JSON.stringify(audit)).not.toContain('not-for-output');
});

test('reports fixture mode when live was requested without a portal URL', async () => {
  vi.stubEnv('WATCH_SOURCE', 'live'); vi.stubEnv('WATCH_PMMP_URL', '');
  try {
    const queue = { client: Promise.resolve({ get: async () => null }), getJobs: async () => [] };
    const controller = new WatchController(queue as never, new InMemorySnapshotRepository(), null as never, null as never, null as never);
    expect((await controller.status()).sourceMode).toBe('fixture');
  } finally { vi.unstubAllEnvs(); }
});

test('manual synchronization advances a delayed discovery when no cooldown applies', async () => {
  const job = { id: '1', delay: 60000, getState: async () => 'delayed', async changeDelay(delay: number) { this.delay = delay; } };
  const queue = { client: Promise.resolve({ get: async () => null }), getJobs: async () => [job] };
  const controller = new WatchController(queue as never, new InMemorySnapshotRepository(), null as never, null as never, null as never);
  await controller.run();
  expect(job.delay).toBe(0);
});

test('latest failed queue job cannot be hidden by an older completed scan', async () => {
  const snapshots = new InMemorySnapshotRepository();
  await snapshots.record({ source: 'watch', url: 'https://portal/', sha256: 'a', bytes: 1, changed: true, parsedOk: true, items: 1 });
  const old = { id: '1', finishedOn: Date.now() - 5000, returnvalue: { status: 'complete', uniqueSeen: 1 } };
  const failed = { id: '2', finishedOn: Date.now(), failedReason: 'internal database details' };
  const queue = { client: Promise.resolve({ get: async () => null }),
    getJobs: async (types: string[]) => types.includes('completed') ? [old] : types.includes('failed') ? [failed] : [],
  };
  const controller = new WatchController(queue as never, snapshots, null as never, null as never, null as never);
  const status = await controller.status();
  expect(status.state).toBe('failed');
  expect(JSON.stringify(status)).not.toContain('internal database details');
});

test('official overnight closure keeps the last run visible and leaves the delayed job in place', async () => {
  vi.stubEnv('WATCH_SOURCE', 'live');
  vi.stubEnv('WATCH_CONTINUOUS', 'true');
  vi.stubEnv('WATCH_PMMP_URL', 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch');
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-12T00:15:00Z'));
    const changeDelay = vi.fn();
    const last = { id: 'previous', returnvalue: { status: 'complete', uniqueSeen: 6200 }, finishedOn: Date.now() - 60_000 };
    const pending = { id: 'next', timestamp: Date.now(), delay: 1000, getState: async () => 'delayed', changeDelay };
    const queue = { client: Promise.resolve({ get: async () => null }),
      getJobs: async (types: string[]) => types.includes('completed') ? [last] : types.includes('delayed') ? [pending] : [],
    };
    const controller = new WatchController(queue as never, new InMemorySnapshotRepository(), null as never, null as never, null as never);
    const reopen = new Date('2026-11-12T07:30:00Z');
    expect(await controller.status()).toMatchObject({
      state: 'closed', portalReopensAt: reopen, nextRunAt: reopen, cooldownUntil: null,
      run: { id: 'previous', uniqueSeen: 6200 },
    });
    expect(await controller.run()).toEqual({ queued: false, portalReopensAt: reopen });
    expect(changeDelay).not.toHaveBeenCalled();
    vi.setSystemTime(reopen);
    expect((await controller.status()).state).not.toBe('closed');
    expect(await controller.run()).toMatchObject({ queued: true, jobId: 'next' });
    expect(changeDelay).toHaveBeenCalledWith(0);
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
});
