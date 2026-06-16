import { describe, expect, it } from 'vitest';
import { crawlDetails, normalizeReference, type CrawlDeps } from './detail.crawler';

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
