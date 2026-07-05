import { describe, expect, test, vi } from 'vitest';
import { SuiviCrawlerService } from './suivi.crawler';
import type { TenderRepository } from '../tender/tender.repository';
import type { IntelRepository } from '../intel/intel.repository';

/**
 * A backlog of N harvestable targets, each with a well-formed detail URL so
 * refOrgFromUrl yields a (refConsultation, orgAcronyme) and the crawler actually
 * attempts a fetch (rather than stamping-and-skipping).
 */
function backlog(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    reference: `AO ${i}/2026`,
    buyerName: 'Commune X',
    deadlineAt: new Date('2026-01-01T00:00:00Z'),
    sourceUrl:
      `https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation` +
      `&refConsultation=${10000 + i}&orgAcronyme=ORG`,
  }));
}

function fakeRepos(targets: ReturnType<typeof backlog>) {
  const tenders = {
    findSuiviBacklogTargets: vi.fn(async () => targets),
    updateEnrichment: vi.fn(async () => {}),
  } as unknown as TenderRepository;
  const intel = {
    upsertCompetitor: vi.fn(async (name: string) => ({ id: `c-${name}` })),
    insertResult: vi.fn(async () => true),
  } as unknown as IntelRepository;
  return { tenders, intel };
}

const blocked = () => ({ ok: false, status: 429, text: async () => '' }) as Response;
const okEmpty = () =>
  ({ ok: true, status: 200, text: async () => '<html></html>' }) as Response;

describe('SuiviCrawlerService circuit breaker', () => {
  test('halts the batch after 5 consecutive fetch failures (does not fire the rest)', async () => {
    const targets = backlog(50);
    const { tenders, intel } = fakeRepos(targets);
    const fetchImpl = vi.fn(async () => blocked());
    const svc = new SuiviCrawlerService(tenders, intel);

    const summary = await svc.crawlBacklog({
      maxSuivi: 50,
      delayMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0.5,
    });

    expect(summary.stoppedEarly).toBe(true);
    expect(summary.fetched).toBe(0);
    // Stopped at the breaker, NOT after all 50 targets.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  test('a success resets the breaker so intermittent failures do not halt', async () => {
    const targets = backlog(12);
    const { tenders, intel } = fakeRepos(targets);
    // Fail 4, succeed 1, then all succeed → never 5 in a row.
    let call = 0;
    const fetchImpl = vi.fn(async () => (call++ < 4 ? blocked() : okEmpty()));
    const svc = new SuiviCrawlerService(tenders, intel);

    const summary = await svc.crawlBacklog({
      maxSuivi: 12,
      delayMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0.5,
    });

    expect(summary.stoppedEarly).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(12); // walked the whole backlog
    expect(summary.fetched).toBe(8);
    expect(summary.errors).toBe(4);
  });

  test('a parse/DB error does not trip the portal breaker', async () => {
    const targets = backlog(10);
    const { tenders } = fakeRepos(targets);
    // Every fetch succeeds, but persistence always throws — 10 in a row.
    const intel = {
      upsertCompetitor: vi.fn(async () => ({ id: 'c' })),
      insertResult: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as IntelRepository;
    // Non-empty commission HTML so there is a bidder to (attempt to) persist.
    const commission = () =>
      ({
        ok: true,
        status: 200,
        text: async () =>
          `<table class="table-results"><tr><th>Entreprise</th><th>Financi</th></tr>` +
          `<tr><td><h3>ACME</h3></td><td>Admissible</td><td>Admissible</td><td>100,00</td></tr></table>`,
      }) as Response;
    const fetchImpl = vi.fn(async () => commission());
    const svc = new SuiviCrawlerService(tenders, intel);

    const summary = await svc.crawlBacklog({
      maxSuivi: 10,
      delayMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0.5,
    });

    // DB errors accumulate but the breaker (a portal-block detector) never trips.
    expect(summary.stoppedEarly).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(summary.fetched).toBe(10);
  });
});
