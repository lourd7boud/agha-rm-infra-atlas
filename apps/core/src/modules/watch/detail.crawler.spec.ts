import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTenderRepository } from '../tender/tender.repository';
import {
  crawlDetails,
  DetailCrawlerService,
  normalizeReference,
  type CrawlDeps,
} from './detail.crawler';
import { FixturePortalSource } from './watch.source';

const PREFIX = 'ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary';
const detailHtml = (reference: string, caution: string): string =>
  `<span id="${PREFIX}_reference">${reference}</span>` +
  `<span id="${PREFIX}_objet">Objet</span>` +
  `<span id="${PREFIX}_cautionProvisoire">${caution}</span>`;

const LISTING =
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=111&orgAcronyme=aaa&retraits">a</a>' +
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=222&orgAcronyme=bbb&depots">b</a>';
const BASE = 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch';

function deps(
  overrides: Partial<CrawlDeps> & Pick<CrawlDeps, 'fetchDetail' | 'tenders'>,
): CrawlDeps {
  return {
    applyEnrichment: async () => {},
    sleep: async () => {},
    now: () => '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeReference', () => {
  it('collapses whitespace and uppercases', () => {
    expect(normalizeReference('  06/br/rgon/2026 ')).toBe('06/BR/RGON/2026');
  });

  it('strips the objet suffix the listing glues onto the reference', () => {
    expect(normalizeReference('19/2026/C.TT - ...')).toBe('19/2026/C.TT');
    expect(normalizeReference('07/2026 - objet: travaux divers')).toBe('07/2026');
    expect(normalizeReference('TE/25/2026')).toBe('TE/25/2026');
  });
});

describe('crawlDetails', () => {
  it('fills only empty fields and counts matched vs enriched', async () => {
    const calls: { id: string; amounts: Record<string, number> }[] = [];
    const summary = await crawlDetails(
      LISTING,
      BASE,
      deps({
        tenders: [
          { id: 't1', reference: 'REF/111' }, // no caution → will be filled
          { id: 't2', reference: 'REF/222', cautionProvisoireMad: 1000 }, // known → kept
        ],
        fetchDetail: async (url) =>
          url.includes('refConsultation=111')
            ? detailHtml('REF/111', '5 000,00 MAD')
            : detailHtml('REF/222', '9 000,00 MAD'),
        applyEnrichment: async (id, amounts) => {
          calls.push({ id, amounts: amounts as Record<string, number> });
        },
      }),
      { delayMs: 0 },
    );

    expect(summary).toEqual({
      linksFound: 2,
      fetched: 2,
      matched: 2,
      enriched: 1,
      errors: 0,
    });
    // t1 gets the caution; t2 (already known) is recorded but not overwritten.
    expect(calls.find((c) => c.id === 't1')?.amounts).toEqual({
      cautionProvisoireMad: 5000,
    });
    expect(calls.find((c) => c.id === 't2')?.amounts).toEqual({});
  });

  it('skips details whose reference matches no stored tender', async () => {
    const summary = await crawlDetails(
      LISTING,
      BASE,
      deps({
        tenders: [{ id: 't1', reference: 'REF/111' }],
        fetchDetail: async () => detailHtml('REF/UNKNOWN', '5 000,00 MAD'),
      }),
      { delayMs: 0 },
    );
    expect(summary.fetched).toBe(2);
    expect(summary.matched).toBe(0);
    expect(summary.enriched).toBe(0);
  });

  it('counts fetch errors and keeps going', async () => {
    const summary = await crawlDetails(
      LISTING,
      BASE,
      deps({
        tenders: [{ id: 't1', reference: 'REF/111' }],
        fetchDetail: async (url) => {
          if (url.includes('refConsultation=111')) throw new Error('timeout');
          return detailHtml('REF/222', '5 000,00 MAD');
        },
      }),
      { delayMs: 0 },
    );
    expect(summary.errors).toBe(1);
    expect(summary.fetched).toBe(1);
  });

  it('respects the maxDetails cap', async () => {
    const summary = await crawlDetails(
      LISTING,
      BASE,
      deps({
        tenders: [],
        fetchDetail: async () => detailHtml('REF/X', '1 000,00 MAD'),
      }),
      { delayMs: 0, maxDetails: 1 },
    );
    expect(summary.linksFound).toBe(1);
    expect(summary.fetched).toBe(1);
  });
});

describe('DetailCrawlerService.backfillMissing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeService(repo: InMemoryTenderRepository): DetailCrawlerService {
    return new DetailCrawlerService(new FixturePortalSource(''), repo);
  }

  async function seed(
    repo: InMemoryTenderRepository,
    reference: string,
    opts: { caution?: number; sourceUrl?: string } = {},
  ) {
    return repo.create({
      reference,
      buyerName: 'COMMUNE DE TEST',
      procedure: 'AOO',
      objet: 'Travaux divers',
      deadlineAt: new Date('2026-09-01T10:00:00Z'),
      ...(opts.caution !== undefined ? { cautionProvisoireMad: opts.caution } : {}),
      ...(opts.sourceUrl !== undefined ? { sourceUrl: opts.sourceUrl } : {}),
    });
  }

  it('fills the caution for rows targeted through their stored detail URL', async () => {
    const repo = new InMemoryTenderRepository();
    const bare = await seed(repo, 'REF/501', { sourceUrl: 'https://portal/d501' });
    await seed(repo, 'REF/502', { caution: 9000, sourceUrl: 'https://portal/d502' }); // complete
    await seed(repo, 'REF/503', {}); // no sourceUrl → untargetable

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(detailHtml('REF/501', '7 500,00 MAD'))),
    );
    const summary = await makeService(repo).backfillMissing({ delayMs: 0 });

    expect(summary.linksFound).toBe(1); // only the bare row with a URL
    expect(summary.enriched).toBe(1);
    const healed = await repo.findById(bare.id);
    expect(healed?.cautionProvisoireMad).toBe(7500);
    expect(healed?.raw && 'detail' in healed.raw).toBe(true);
  });

  it('stamps raw.detail even when the page prints no caution — one attempt per row', async () => {
    const repo = new InMemoryTenderRepository();
    await seed(repo, 'REF/601', { sourceUrl: 'https://portal/d601' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(detailHtml('REF/601', ''))),
    );
    const service = makeService(repo);
    const first = await service.backfillMissing({ delayMs: 0 });
    expect(first.linksFound).toBe(1);
    expect(first.enriched).toBe(0);

    // Second run: the stamp excludes the row — the work list shrank to zero.
    const second = await service.backfillMissing({ delayMs: 0 });
    expect(second.linksFound).toBe(0);
  });

  it('a fetch failure leaves the row unstamped for a future retry', async () => {
    const repo = new InMemoryTenderRepository();
    const row = await seed(repo, 'REF/701', { sourceUrl: 'https://portal/d701' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    const summary = await makeService(repo).backfillMissing({ delayMs: 0 });
    expect(summary.errors).toBe(1);
    const kept = await repo.findById(row.id);
    expect(kept?.raw).toBeNull(); // still a target next run
  });
});
