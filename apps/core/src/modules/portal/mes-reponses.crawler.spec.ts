import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  harvestMesReponses,
  type MesReponsesCrawlDeps,
} from './mes-reponses.crawler';
import { InMemoryPortalRepository } from './portal.repository';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/portal/fixtures/mes-reponses.html'),
  'utf8',
);

/** Deps over the fixture + a real InMemoryPortalRepository, single page. */
function deps(
  repo: InMemoryPortalRepository,
  overrides: Partial<MesReponsesCrawlDeps> = {},
): MesReponsesCrawlDeps {
  return {
    fetchPage: async () => FIXTURE,
    upsertSubmission: (input) => repo.upsertSubmission(input),
    sleep: async () => {},
    ...overrides,
  };
}

describe('harvestMesReponses', () => {
  test('upserts every well-formed soumission and counts inserts + skips', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act — the fixture has 3 valid rows + 1 corrupted row, on a single page.
    const summary = await harvestMesReponses(deps(repo), {
      delayMs: 0,
      maxPages: 1,
    });

    // Assert
    expect(summary).toEqual({
      fetched: 3,
      inserted: 3,
      updated: 0,
      skipped: 1,
    });
    expect(await repo.listSubmissions(10)).toHaveLength(3);
  });

  test('persists the parsed référence + deadline of each upserted row', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act
    await harvestMesReponses(deps(repo), { delayMs: 0, maxPages: 1 });

    // Assert — a référence with embedded slashes must survive intact.
    const rows = await repo.listSubmissions(10);
    const references = rows.map((row) => row.reference).sort();
    expect(references).toEqual(['01/2026', '14/2026/AUAM', '62/2025/DP A/IF']);
  });

  test('is idempotent: a second run re-visits every row as updated, no dup', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await harvestMesReponses(deps(repo), { delayMs: 0, maxPages: 1 });

    // Act — same fixture, same repository.
    const second = await harvestMesReponses(deps(repo), {
      delayMs: 0,
      maxPages: 1,
    });

    // Assert — every row matched its (reference, deadline) key → all 'updated'.
    expect(second).toEqual({
      fetched: 3,
      inserted: 0,
      updated: 3,
      skipped: 1,
    });
    expect(await repo.listSubmissions(10)).toHaveLength(3);
  });

  test('reports skipped rows through the onSkipped callback', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    const skips: number[] = [];

    // Act
    await harvestMesReponses(
      deps(repo, {
        onSkipped: (outcome) => skips.push(outcome.skipped.length),
      }),
      { delayMs: 0, maxPages: 1 },
    );

    // Assert
    expect(skips).toEqual([1]);
  });

  test('stops cleanly and counts nothing on a page without the results table', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act
    const summary = await harvestMesReponses(
      deps(repo, {
        fetchPage: async () => '<html><body>maintenance</body></html>',
      }),
      { delayMs: 0, maxPages: 1 },
    );

    // Assert
    expect(summary).toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
    });
    expect(await repo.listSubmissions(10)).toEqual([]);
  });

  test('does not crash when a page fetch throws — keeps prior totals', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act — first page throws before any row is stored.
    const summary = await harvestMesReponses(
      deps(repo, {
        fetchPage: async () => {
          throw new Error('portal unreachable');
        },
      }),
      { delayMs: 0, maxPages: 1 },
    );

    // Assert — resolved, not rejected, with zeroed totals.
    expect(summary).toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
    });
  });
});
