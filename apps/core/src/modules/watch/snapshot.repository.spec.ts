import { expect, test } from 'vitest';
import { InMemorySnapshotRepository } from './snapshot.repository';

test('a failed parse does not erase the last successful parse timestamp', async () => {
  const repo = new InMemorySnapshotRepository();
  const input = { source: 'watch', url: 'https://portal/', sha256: 'a', bytes: 30, changed: true, parsedOk: true, items: 10 };
  const good = await repo.record(input);
  await repo.record({ ...input, parsedOk: false, items: 0, sha256: 'b' });
  const [coverage] = await repo.coverage();
  expect(coverage?.lastParseOk).toBe(false);
  expect(coverage?.lastSuccessAt).toEqual(good.fetchedAt);
});
