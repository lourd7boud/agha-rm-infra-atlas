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
          <td><a href="d?ref=${ref}">${ref}</a> - <span>Objet : ${objet}</span>
            <div id="x_panelBlocDenomination"><strong>Acheteur public :</strong> ORMVA du Souss Massa</div></td>
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
      healed: 0,
      sourceUrlBackfilled: 0,
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

  test('second run is a true no-op when nothing changed (idempotent watching)', async () => {
    const repository = new InMemoryTenderRepository();
    const service = makeService(repository);
    await service.runOnce();
    const second = await service.runOnce();

    // The fixture tenders carry a canonical sourceUrl, so the re-crawl matches
    // the stored rows on that stable key — but since no listing field changed,
    // the heal is a no-op (the field-diff WHERE matches nothing: no write churn),
    // and each row then confirms as an existing duplicate. Nothing is inserted.
    expect(second.inserted).toBe(0);
    expect(second.healed).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(await repository.findAll()).toHaveLength(3);
  });

  test('heals a legacy messy row in place when a clean crawl shares its sourceUrl', async () => {
    const repo = new InMemoryTenderRepository();
    const sourceUrl =
      'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=977311&orgAcronyme=m8x';
    // A legacy row as the OLD positional parser stored it: reference glued to the
    // objet, buyer_name holding the lieu d'exécution. Inserted directly because
    // the NEW parser can no longer produce that shape.
    await repo.create({
      reference: '06/BR/RGON/2026 - travaux',
      buyerName: 'GUELMIM',
      procedure: 'AOO',
      objet: 'Travaux',
      deadlineAt: new Date('2026-07-15T09:00:00Z'),
      sourceUrl,
    });

    // A clean crawl of the SAME consultation (same canonical détails link). The
    // source reports the real PMMP base so the parser's rebuilt canonical
    // sourceUrl matches the stored one (buildDetailUrl is base-relative).
    const clean = `<html><body><table class="table-results"><tbody><tr>
      <td><input /></td><td>AOO Appel d'offres ouvert</td>
      <td><span class="ref">06/BR/RGON/2026</span>
        <div id="x_panelBlocObjet"><strong>Objet :</strong> Travaux de construction d'un ouvrage</div>
        <div id="x_panelBlocDenomination"><strong>Acheteur public :</strong> REGION DE GUELMIM - OUED NOUN</div></td>
      <td><div id="x_panelBlocLieuxExec">GUELMIM<div class="info-bulle"><div>GUELMIM</div></div></div></td>
      <td>15/07/202610:00</td>
      <td><a href="${sourceUrl}&retraits">0</a></td>
    </tr></tbody></table></body></html>`;
    const cleanSource: PortalSource = {
      async fetch(page = 1) {
        return {
          html: page > 1 ? '<html><body></body></html>' : clean,
          sourceUrl: 'https://www.marchespublics.gov.ma/',
        };
      },
    };

    const second = await new WatchService(cleanSource, repo).runOnce();
    expect(second.healed).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(0);

    const after = await repo.findAll();
    expect(after).toHaveLength(1); // healed in place — no duplicate row
    expect(after[0]!.reference).toBe('06/BR/RGON/2026');
    expect(after[0]!.buyerName).toBe('REGION DE GUELMIM - OUED NOUN');
    expect(after[0]!.location).toBe('GUELMIM');
  });

  test('heals a legacy NULL source_url on a later crawl that exposes the link', async () => {
    const repo = new InMemoryTenderRepository();
    const cell2 = `<td><a href="javascript:popUp('x')">12/2026/AB</a> - <span>Objet : Travaux</span><div id="x_panelBlocDenomination"><strong>Acheteur public :</strong> Commune X</div></td>`;
    const rowNoLink = `<html><body><table class="table-results"><tbody><tr>
      <td><input /></td><td>AOO Appel d'offres ouvert</td>${cell2}
      <td>Commune X</td><td>15/07/202610:00</td><td></td>
    </tr></tbody></table></body></html>`;
    const rowWithLink = `<html><body><table class="table-results"><tbody><tr>
      <td><input /></td><td>AOO Appel d'offres ouvert</td>${cell2}
      <td>Commune X</td><td>15/07/202610:00</td>
      <td><a href="https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=900111&orgAcronyme=z9z&retraits">0</a></td>
    </tr></tbody></table></body></html>`;

    // First crawl: no resolvable link → stored with NULL source_url.
    const first = await new WatchService(
      new PagedFakeSource([rowNoLink]),
      repo,
    ).runOnce();
    expect(first.inserted).toBe(1);
    expect((await repo.findAll())[0]!.sourceUrl).toBeUndefined();

    // Later crawl: same tender, link now present → duplicate + backfill.
    const second = await new WatchService(
      new PagedFakeSource([rowWithLink]),
      repo,
    ).runOnce();
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.sourceUrlBackfilled).toBe(1);
    const healed = (await repo.findAll())[0]!.sourceUrl;
    expect(healed).toContain('EntrepriseDetailsConsultation');
    expect(healed).toContain('refConsultation=900111&orgAcronyme=z9z');
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
      // random=0.5 → jitter maps exactly to the base delay (midpoint).
      { maxPages: 3, delayMs: 500, sleep, random: () => 0.5 },
    );

    await service.runOnce();

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  test('jitters the inter-hop delay so the cadence is not fixed', async () => {
    const sleep = vi.fn(async () => {});
    // A deterministic RNG that walks 0 → 1 so successive gaps differ.
    const seq = [0, 1];
    let i = 0;
    const source = new PagedFakeSource([
      rowsTable([['A/1', 'un']]),
      rowsTable([['B/1', 'deux']]),
      rowsTable([['C/1', 'trois']]),
    ]);
    const service = new WatchService(
      source,
      new InMemoryTenderRepository(),
      null,
      { maxPages: 3, delayMs: 1000, sleep, random: () => seq[i++ % seq.length] ?? 0 },
    );

    await service.runOnce();

    // ±40% window: random=0 → 600ms, random=1 → 1400ms. Never the flat 1000.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 600);
    expect(sleep).toHaveBeenNthCalledWith(2, 1400);
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

  test('runs the PV harvest stage when a crawler is injected and WATCH_PV_LIMIT > 0', async () => {
    const pvCrawler = { crawlOnce: vi.fn().mockResolvedValue({ pvFound: 2 }) };
    process.env.WATCH_PV_LIMIT = '7';
    process.env.WATCH_PV_MAX_PAGES = '2';
    try {
      const service = new WatchService(
        new FixturePortalSource(FIXTURE_PATH),
        new InMemoryTenderRepository(),
        null,
        { maxPages: 1 },
        null,
        null,
        pvCrawler as never,
      );
      await service.runOnce();
      expect(pvCrawler.crawlOnce).toHaveBeenCalledWith({ maxPv: 7, maxPages: 2 });
    } finally {
      delete process.env.WATCH_PV_LIMIT;
      delete process.env.WATCH_PV_MAX_PAGES;
    }
  });

  test('skips the PV harvest stage by default (WATCH_PV_LIMIT unset → 0)', async () => {
    const pvCrawler = { crawlOnce: vi.fn() };
    const service = new WatchService(
      new FixturePortalSource(FIXTURE_PATH),
      new InMemoryTenderRepository(),
      null,
      { maxPages: 1 },
      null,
      null,
      pvCrawler as never,
    );
    await service.runOnce();
    expect(pvCrawler.crawlOnce).not.toHaveBeenCalled();
  });

  test('a PV harvest failure never fails the sweep', async () => {
    const pvCrawler = {
      crawlOnce: vi.fn().mockRejectedValue(new Error('portal down')),
    };
    process.env.WATCH_PV_LIMIT = '3';
    try {
      const service = new WatchService(
        new FixturePortalSource(FIXTURE_PATH),
        new InMemoryTenderRepository(),
        null,
        { maxPages: 1 },
        null,
        null,
        pvCrawler as never,
      );
      const summary = await service.runOnce();
      expect(summary.inserted).toBeGreaterThan(0); // sweep survived
    } finally {
      delete process.env.WATCH_PV_LIMIT;
    }
  });
});
