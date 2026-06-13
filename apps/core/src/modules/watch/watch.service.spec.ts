import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { InMemoryTenderRepository } from '../tender/tender.repository';
import { InMemorySnapshotRepository } from './snapshot.repository';
import { WatchService } from './watch.service';
import {
  FixturePortalSource,
  type PortalPage,
  type PortalSource,
} from './watch.source';

const FIXTURE_PATH = join(
  process.cwd(),
  'src/modules/watch/fixtures/pmmp-results.html',
);

function makeService(repository: InMemoryTenderRepository) {
  return new WatchService(new FixturePortalSource(FIXTURE_PATH), repository);
}

/** Source returning a distinct HTML page per index, then empty past the end. */
class PagedFakeSource implements PortalSource {
  readonly requested: number[] = [];
  constructor(private readonly pages: readonly string[]) {}

  async fetch(page = 1): Promise<PortalPage> {
    this.requested.push(page);
    const html = this.pages[page - 1] ?? '<html><body></body></html>';
    return { html, sourceUrl: `https://portal/?p=${page}` };
  }
}

/** Source that throws once it is asked for a page beyond `failFrom`. */
class FlakyPagedSource implements PortalSource {
  readonly requested: number[] = [];
  constructor(
    private readonly pages: readonly string[],
    private readonly failFrom: number,
  ) {}

  async fetch(page = 1): Promise<PortalPage> {
    this.requested.push(page);
    if (page >= this.failFrom) throw new Error(`portal down on page ${page}`);
    return { html: this.pages[page - 1] ?? '', sourceUrl: `https://portal/?p=${page}` };
  }
}

function rowsTable(rows: ReadonlyArray<[ref: string, objet: string]>): string {
  const body = rows
    .map(
      ([ref, objet]) => `
        <tr>
          <td><input type="checkbox" /></td>
          <td>AOO Appel d'offres ouvert Travaux</td>
          <td><a href="d?ref=${ref}">${ref}</a> - <span>Objet : ${objet}</span></td>
          <td>- ORMVA du Souss Massa</td>
          <td>15/07/202610:00</td>
          <td></td><td>: 0 : 0</td>
        </tr>`,
    )
    .join('');
  return `<html><body><table class="table-results"><tbody>${body}</tbody></table></body></html>`;
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
      pagesFetched: 1,
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

  test('single-page source is fetched once even with a high page cap', async () => {
    const source = new FixturePortalSource(FIXTURE_PATH);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      null,
      { maxPages: 10 },
    );
    const summary = await service.runOnce();
    // Page 2 repeats page 1's content → the run ends after one page.
    expect(summary.pagesFetched).toBe(1);
    expect(summary.inserted).toBe(3);
  });

  test('walks multiple pages and ingests the whole result set', async () => {
    const repository = new InMemoryTenderRepository();
    const source = new PagedFakeSource([
      rowsTable([
        ['A/1', 'Objet un'],
        ['A/2', 'Objet deux'],
      ]),
      rowsTable([
        ['B/1', 'Objet trois'],
        ['B/2', 'Objet quatre'],
      ]),
    ]);
    const service = new WatchService(source, repository, null, { maxPages: 10 });

    const summary = await service.runOnce();

    expect(summary.pagesFetched).toBe(2);
    expect(summary.inserted).toBe(4);
    expect(await repository.findAll()).toHaveLength(4);
    // Page 1, page 2, then page 3 (empty) ends the walk.
    expect(source.requested).toEqual([1, 2, 3]);
  });

  test('stops at the maxPages cap', async () => {
    const repository = new InMemoryTenderRepository();
    const source = new PagedFakeSource([
      rowsTable([['A/1', 'un']]),
      rowsTable([['B/1', 'deux']]),
      rowsTable([['C/1', 'trois']]),
    ]);
    const service = new WatchService(source, repository, null, { maxPages: 2 });

    const summary = await service.runOnce();

    expect(summary.pagesFetched).toBe(2);
    expect(summary.inserted).toBe(2);
    expect(source.requested).toEqual([1, 2]);
  });

  test('a poisoned (NaN) maxPages still fetches page 1', async () => {
    const repository = new InMemoryTenderRepository();
    const service = new WatchService(
      new FixturePortalSource(FIXTURE_PATH),
      repository,
      null,
      { maxPages: Number.NaN },
    );
    const summary = await service.runOnce();
    expect(summary.pagesFetched).toBe(1);
    expect(summary.inserted).toBe(3);
  });

  test('a mid-walk fetch failure ends the run with a partial summary', async () => {
    const repository = new InMemoryTenderRepository();
    const source = new FlakyPagedSource(
      [rowsTable([['A/1', 'un'], ['A/2', 'deux']])],
      2,
    );
    const service = new WatchService(source, repository, null, { maxPages: 10 });

    const summary = await service.runOnce();

    expect(summary.inserted).toBe(2); // page 1 survived
    expect(summary.errors).toBe(1); // page 2 failed
    expect(summary.pagesFetched).toBe(1);
    expect(await repository.findAll()).toHaveLength(2);
  });

  test('inserts a polite delay between pages but not after the last', async () => {
    const sleep = vi.fn(async () => {});
    const source = new PagedFakeSource([
      rowsTable([['A/1', 'un']]),
      rowsTable([['B/1', 'deux']]),
      rowsTable([['C/1', 'trois']]),
    ]);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      null,
      { maxPages: 3, delayMs: 500, sleep },
    );

    await service.runOnce();

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  test('does not sleep when delayMs is zero', async () => {
    const sleep = vi.fn(async () => {});
    const source = new PagedFakeSource([
      rowsTable([['A/1', 'un']]),
      rowsTable([['B/1', 'deux']]),
    ]);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      null,
      { maxPages: 5, delayMs: 0, sleep },
    );

    await service.runOnce();

    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('WatchService snapshot/coverage', () => {
  test('records a parser miss when the first page has no rows', async () => {
    const snapshots = new InMemorySnapshotRepository();
    const source = new PagedFakeSource([rowsTable([])]);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      snapshots,
      { maxPages: 5 },
    );

    const summary = await service.runOnce();

    expect(summary.fetched).toBe(0);
    expect(summary.pagesFetched).toBe(1);
    const [coverage] = await snapshots.coverage();
    expect(coverage?.fetches).toBe(1);
    expect(coverage?.lastParseOk).toBe(false);
  });

  test('records one snapshot per fetched page', async () => {
    const snapshots = new InMemorySnapshotRepository();
    const source = new PagedFakeSource([
      rowsTable([['A/1', 'un'], ['A/2', 'deux']]),
      rowsTable([['B/1', 'trois']]),
    ]);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      snapshots,
      { maxPages: 10 },
    );

    await service.runOnce();

    const [coverage] = await snapshots.coverage();
    expect(coverage?.fetches).toBe(2);
    expect(coverage?.itemsExtracted).toBe(3);
    expect(coverage?.lastParseOk).toBe(true);
  });

  test('flags a second identical run as unchanged via per-URL lastSha', async () => {
    const snapshots = new InMemorySnapshotRepository();
    const makeSource = () =>
      new PagedFakeSource([
        rowsTable([['A/1', 'un']]),
        rowsTable([['B/1', 'deux']]),
      ]);
    const repository = new InMemoryTenderRepository();

    const first = await new WatchService(
      makeSource(),
      repository,
      snapshots,
      { maxPages: 10 },
    ).runOnce();
    expect(first.unchanged).toBeUndefined();

    const second = await new WatchService(
      makeSource(),
      repository,
      snapshots,
      { maxPages: 10 },
    ).runOnce();

    expect(second.unchanged).toBe(true);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
  });
});
