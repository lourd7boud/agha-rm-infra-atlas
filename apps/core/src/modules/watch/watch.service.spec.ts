import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { InMemoryTenderRepository } from '../tender/tender.repository';
import { WatchService } from './watch.service';
import { FixturePortalSource } from './watch.source';

const FIXTURE_PATH = join(
  process.cwd(),
  'src/modules/watch/fixtures/pmmp-results.html',
);

function makeService(repository: InMemoryTenderRepository) {
  return new WatchService(new FixturePortalSource(FIXTURE_PATH), repository);
}

describe('WatchService.runOnce', () => {
  test('ingests every parsed tender on first run', async () => {
    const repository = new InMemoryTenderRepository();
    const summary = await makeService(repository).runOnce();

    expect(summary).toEqual({
      fetched: 3,
      inserted: 3,
      duplicates: 0,
      skippedRows: 1,
      errors: 0,
    });
    const stored = await repository.findAll();
    expect(stored.map((t) => t.pipelineState)).toEqual([
      'detected',
      'detected',
      'detected',
    ]);
  });

  test('second run detects only duplicates (idempotent watching)', async () => {
    const repository = new InMemoryTenderRepository();
    const service = makeService(repository);
    await service.runOnce();
    const second = await service.runOnce();

    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(await repository.findAll()).toHaveLength(3);
  });
});
