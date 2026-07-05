import { describe, expect, it } from 'vitest';
import { crawlExtraitsPv, type PvCrawlDeps, type StoredPvBid } from './pv.crawler';
import { PortalBlockedError } from './portal-fetch';

const PREFIX = 'ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary';
const LISTING =
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=111&orgAcronyme=aaa">a</a>' +
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=222&orgAcronyme=bbb">b</a>';
const BASE = 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch';

const detailWithNotice = (ref: string, rc: string, org: string): string =>
  `<span id="${PREFIX}_reference">${ref}</span>` +
  `<a href="index.php?page=entreprise.EntrepriseDownloadAvisJAL&refConsultation=${rc}&orgAcronyme=${org}&idAvis=999">notice</a>`;

const pvJson = (winner: string): string =>
  JSON.stringify({
    acheteur: 'Commune X',
    objet: 'travaux',
    estimation_mad: 1_000_000,
    soumissionnaires: [
      { nom: winner, montant_mad: 800000, retenu: true },
      { nom: 'STE LOSER', montant_mad: 950000, retenu: false },
    ],
    lisible: true,
  });

// %PDF magic header — the OCR router treats these bytes as a PDF; the actual
// OCR pipeline is mocked through extractAvisText so tests stay deterministic.
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function deps(o: Partial<PvCrawlDeps>): PvCrawlDeps {
  return {
    search: async () => ({ listingHtml: LISTING, baseUrl: BASE }),
    fetchDetail: async (url) =>
      url.includes('refConsultation=111')
        ? detailWithNotice('REF/111', '111', 'aaa')
        : detailWithNotice('REF/222', '222', 'bbb'),
    fetchAvisBytes: async () => PDF_HEADER,
    extractAvisText: async () => pvJson('STE ALPHA'),
    storeBid: async () => 'inserted',
    sleep: async () => {},
    now: () => new Date('2026-06-16T00:00:00Z'),
    ...o,
  };
}

describe('crawlExtraitsPv', () => {
  it('stores every bidder (winner + losers) with the estimation attached', async () => {
    const stored: StoredPvBid[] = [];
    const s = await crawlExtraitsPv(
      deps({ storeBid: async (b) => (stored.push(b), 'inserted') }),
      { delayMs: 0 },
    );
    expect(s).toMatchObject({ pvFound: 2, notices: 2, pvRead: 2, errors: 0 });
    expect(s.bidsStored).toBe(4); // 2 PVs × 2 bidders
    expect(stored.filter((b) => b.isWinner)).toHaveLength(2);
    expect(stored.every((b) => b.estimationMad === 1_000_000)).toBe(true);
    const winner = stored.find((b) => b.isWinner);
    expect(winner?.bidderName).toBe('STE ALPHA');
    expect(winner?.amountMad).toBe(800_000);
  });

  it('skips a detail page with no downloadable notice', async () => {
    const s = await crawlExtraitsPv(
      deps({ fetchDetail: async () => '<span>no notice here</span>' }),
      { delayMs: 0 },
    );
    expect(s.notices).toBe(0);
    expect(s.bidsStored).toBe(0);
  });

  it('skips an unreadable PV without storing bids', async () => {
    const s = await crawlExtraitsPv(
      deps({
        extractAvisText: async () =>
          JSON.stringify({ soumissionnaires: [], lisible: false }),
      }),
      { delayMs: 0 },
    );
    expect(s.pvRead).toBe(0);
    expect(s.bidsStored).toBe(0);
  });

  it('counts an unparseable LLM read as an error, not a silent skip', async () => {
    const s = await crawlExtraitsPv(
      deps({ extractAvisText: async () => 'illisible, aucune donnée JSON' }),
      { delayMs: 0 },
    );
    expect(s.pvRead).toBe(0);
    expect(s.errors).toBe(2); // both PVs returned unparseable JSON
    expect(s.bidsStored).toBe(0);
  });

  it('counts an error when a fetch throws, and still processes the rest', async () => {
    let n = 0;
    const s = await crawlExtraitsPv(
      deps({
        fetchDetail: async (url) => {
          n += 1;
          if (n === 1) throw new Error('boom');
          return url.includes('222')
            ? detailWithNotice('REF/222', '222', 'bbb')
            : detailWithNotice('REF/111', '111', 'aaa');
        },
      }),
      { delayMs: 0 },
    );
    expect(s.errors).toBe(1);
    expect(s.bidsStored).toBe(2); // the surviving PV still stored its 2 bidders
  });
});

describe('crawlExtraitsPv circuit breaker', () => {
  it('returns stoppedEarly when the search request is blocked', async () => {
    const s = await crawlExtraitsPv(
      deps({
        search: async () => {
          throw new PortalBlockedError(403);
        },
      }),
      { delayMs: 0 },
    );
    expect(s.stoppedEarly).toBe(true);
    expect(s.pvFound).toBe(0);
  });

  it('stops the per-item loop immediately on a portal block', async () => {
    let calls = 0;
    const s = await crawlExtraitsPv(
      deps({
        fetchDetail: async () => {
          calls += 1;
          throw new PortalBlockedError(429);
        },
      }),
      { delayMs: 0 },
    );
    expect(s.stoppedEarly).toBe(true);
    expect(calls).toBe(1); // did not fire the second item into the block
  });
});
