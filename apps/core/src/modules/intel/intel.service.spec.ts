import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { FixturePortalSource } from '../watch/watch.source';
import {
  InMemoryIntelRepository,
  normalizeCompanyName,
} from './intel.repository';
import { IntelService } from './intel.service';

const FIXTURE_PATH = join(
  process.cwd(),
  'src/modules/intel/fixtures/pmmp-resultats.html',
);

function makeService(repository: InMemoryIntelRepository) {
  return new IntelService(new FixturePortalSource(FIXTURE_PATH), repository);
}

describe('normalizeCompanyName', () => {
  test('unifies legal forms, case, accents and punctuation', () => {
    expect(normalizeCompanyName('SOTRAVHYD SARL')).toBe(
      normalizeCompanyName('Sotravhyd S.A.R.L'),
    );
    expect(normalizeCompanyName('STE ATLAS TRAVAUX SA')).toBe(
      normalizeCompanyName('Atlas Travaux S.A.'),
    );
  });
});

describe('IntelService.harvestOnce', () => {
  test('harvests winners and resolves entity aliases to one competitor', async () => {
    const repository = new InMemoryIntelRepository();
    const summary = await makeService(repository).harvestOnce();

    expect(summary).toEqual({
      fetched: 3,
      inserted: 3,
      duplicates: 0,
      skippedRows: 1,
    });

    const stats = await repository.listCompetitorStats();
    // SOTRAVHYD SARL and Sotravhyd S.A.R.L resolve to ONE competitor.
    expect(stats).toHaveLength(2);
    const sotravhyd = stats.find((s) => s.canonicalName === 'SOTRAVHYD SARL');
    expect(sotravhyd?.wins).toBe(2);
    expect(sotravhyd?.totalMad).toBe(7_842_300.5 + 3_980_750);
  });

  test('second harvest is idempotent', async () => {
    const repository = new InMemoryIntelRepository();
    const service = makeService(repository);
    await service.harvestOnce();
    const second = await service.harvestOnce();

    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(await repository.listResults(10)).toHaveLength(3);
  });
});
