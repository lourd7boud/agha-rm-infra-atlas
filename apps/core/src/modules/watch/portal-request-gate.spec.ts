import { expect, test } from 'vitest';
import { PortalRequestGate } from './portal-request-gate';
import { PortalBlockedError } from './portal-fetch';

test('serializes listing and metadata requests without starting their deadlines while queued', async () => {
  const gate = new PortalRequestGate();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const first = gate.run(async () => { order.push('listing'); await pending; order.push('listing done'); });
  const second = gate.run(async () => { order.push('metadata'); });
  await Promise.resolve(); await Promise.resolve();
  expect(order).toEqual(['listing']);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['listing', 'listing done', 'metadata']);
});

test('publishes a block before allowing the next queued portal request', async () => {
  let paused = false;
  let requests = 0;
  const gate = new PortalRequestGate({ shouldPause: async () => paused, onBlocked: async () => { paused = true; } });
  const first = gate.run(async () => { requests++; throw new PortalBlockedError(433); });
  const second = gate.run(async () => { requests++; return 'not sent'; });
  const result = await Promise.allSettled([first, second]);
  expect(result.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(result[1]).toMatchObject({ reason: { name: 'PortalPausedError' } });
  expect(requests).toBe(1);
});

test('a transient request failure does not poison subsequent gate operations', async () => {
  const gate = new PortalRequestGate();
  await expect(gate.run(async () => { throw new Error('timeout'); })).rejects.toThrow('timeout');
  await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered');
});
