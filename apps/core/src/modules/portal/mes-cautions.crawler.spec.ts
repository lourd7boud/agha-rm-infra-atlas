import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  crawlMesCautions,
  MesCautionsCrawlerService,
  type MesCautionsCrawlDeps,
} from './mes-cautions.crawler';
import { InMemoryPortalRepository } from './portal.repository';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/portal/fixtures/mes-cautions.html'),
  'utf8',
);

// A fake authedFetch standing in for PortalAuthSession.authedFetch: it ignores
// the URL and returns the fixture HTML, exactly as a logged-in READ-ONLY GET of
// page=entreprise.MesCautions would.
function deps(o: Partial<MesCautionsCrawlDeps> = {}): MesCautionsCrawlDeps {
  const repo = new InMemoryPortalRepository();
  return {
    fetchListing: async () => FIXTURE,
    upsertCaution: (input) => repo.upsertCaution(input),
    ...o,
  };
}

describe('crawlMesCautions', () => {
  it('upserts every well-formed caution and counts the skipped row', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act — fixture has 3 well-formed rows + 1 corrupted row the parser skips.
    const summary = await crawlMesCautions({
      fetchListing: async () => FIXTURE,
      upsertCaution: (input) => repo.upsertCaution(input),
    });

    // Assert
    expect(summary).toEqual({
      fetched: 3,
      inserted: 3,
      updated: 0,
      skipped: 1,
    });
    const stored = await repo.listCautions(10);
    expect(stored).toHaveLength(3);
    expect(stored.map((c) => c.reference).sort()).toEqual([
      '01/2026',
      '03/2026/AUAM',
      '62/2025/DP A/IF',
    ]);
  });

  it('persists the parsed caution fields to the repository', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act
    await crawlMesCautions({
      fetchListing: async () => FIXTURE,
      upsertCaution: (input) => repo.upsertCaution(input),
    });

    // Assert — the validée row round-trips montant/banque/statut/demande.
    const stored = await repo.listCautions(10);
    const validee = stored.find((c) => c.reference === '01/2026');
    expect(validee?.amountMad).toBe(7700);
    expect(validee?.bankName).toBe('Caisse de Dépôt et de Gestion');
    expect(validee?.statut).toBe('Validée par la banque');
    expect(validee?.demandeFile).toBe('Demande_Caution_CDG_1191740.pdf');
  });

  it('is idempotent: a second harvest updates, never duplicates', async () => {
    // Arrange — share ONE repository across two harvests of the same listing.
    const repo = new InMemoryPortalRepository();
    const fetchListing = async (): Promise<string> => FIXTURE;

    // Act
    const first = await crawlMesCautions({
      fetchListing,
      upsertCaution: (input) => repo.upsertCaution(input),
    });
    const second = await crawlMesCautions({
      fetchListing,
      upsertCaution: (input) => repo.upsertCaution(input),
    });

    // Assert — first inserts, second only updates; row count stays at 3.
    expect(first.inserted).toBe(3);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(3);
    expect(await repo.listCautions(10)).toHaveLength(3);
  });

  it('counts a throwing upsert as skipped and keeps harvesting', async () => {
    // Arrange — fail the very first upsert, succeed on the rest.
    const repo = new InMemoryPortalRepository();
    let calls = 0;

    // Act
    const summary = await crawlMesCautions(
      deps({
        upsertCaution: (input) => {
          calls += 1;
          if (calls === 1) throw new Error('transient DB error');
          return repo.upsertCaution(input);
        },
      }),
    );

    // Assert — one failed store is folded into skipped, the run completes.
    expect(summary.fetched).toBe(3);
    expect(summary.inserted).toBe(2);
    expect(summary.skipped).toBe(2); // 1 parser-skip + 1 failed upsert
  });

  it('returns an all-zero summary on a page without the results table', async () => {
    // Arrange / Act
    const summary = await crawlMesCautions(
      deps({ fetchListing: async () => '<html><body>maintenance</body></html>' }),
    );

    // Assert
    expect(summary).toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
    });
  });
});

describe('MesCautionsCrawlerService.harvest', () => {
  it('throws a clear error when the portal session is null (no credentials)', async () => {
    // Arrange — the session provider yields null when credentials are absent; a
    // direct harvest() call must fail loudly, not crash on null.authedFetch.
    const repo = new InMemoryPortalRepository();
    const service = new MesCautionsCrawlerService(null, repo);

    // Act / Assert
    await expect(service.harvest()).rejects.toThrow(
      /PORTAL_AUTH_LOGIN\/PORTAL_AUTH_PASSWORD/,
    );
    expect(await repo.listCautions(10)).toHaveLength(0);
  });
});
