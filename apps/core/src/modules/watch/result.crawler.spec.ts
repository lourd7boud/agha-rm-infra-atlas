import { describe, expect, it } from 'vitest';
import { crawlResults, type ResultCrawlDeps, type StoredResult } from './result.crawler';

const PREFIX = 'ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary';
const LISTING =
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=111&orgAcronyme=aaa&retraits">a</a>' +
  '<a href="x?page=entreprise.EntrepriseDetailsConsultation&refConsultation=222&orgAcronyme=bbb&depots">b</a>';
const BASE = 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch';

const detailWithNotice = (ref: string, rc: string, org: string): string =>
  `<span id="${PREFIX}_reference">${ref}</span>` +
  `<a href="index.php?page=entreprise.EntrepriseDownloadAvisJAL&refConsultation=${rc}&orgAcronyme=${org}&idAvis=999">notice</a>`;
const detailNoNotice = (ref: string): string =>
  `<span id="${PREFIX}_reference">${ref}</span>`;

const readable = (attr: string): string =>
  `{"attributaire":"${attr}","acheteur":"Commune X","montant_attribue_mad":500000,"lisible":true}`;

// %PDF magic header — the OCR router treats these bytes as a real PDF blob
// (the dossier-text path is mocked through extractAvisText in the tests).
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function deps(o: Partial<ResultCrawlDeps>): ResultCrawlDeps {
  return {
    search: async () => ({ listingHtml: LISTING, baseUrl: BASE }),
    fetchDetail: async (url) =>
      url.includes('refConsultation=111')
        ? detailWithNotice('REF/111', '111', 'aaa')
        : detailWithNotice('REF/222', '222', 'bbb'),
    fetchAvisBytes: async () => PDF_HEADER,
    extractAvisText: async () => readable('STE ALPHA'),
    storeResult: async () => true,
    sleep: async () => {},
    now: () => new Date('2026-06-16T00:00:00Z'),
    ...o,
  };
}

describe('crawlResults', () => {
  it('reads each notice and stores the winner', async () => {
    const stored: StoredResult[] = [];
    const s = await crawlResults(
      deps({ storeResult: async (r) => (stored.push(r), true) }),
      { delayMs: 0 },
    );
    expect(s).toEqual({ resultsFound: 2, notices: 2, extracted: 2, stored: 2, errors: 0 });
    expect(stored[0]?.bidderName).toBe('STE ALPHA');
    expect(stored[0]?.amountMad).toBe(500000);
    expect(stored[0]?.buyerName).toBe('Commune X');
  });

  it('carries the estimation and objet through to the stored record', async () => {
    const stored: StoredResult[] = [];
    const noticeWithEstimation =
      '{"attributaire":"STE BETA","acheteur":"ANEF","montant_attribue_mad":800000,' +
      '"estimation_mad":1000000,"objet":"travaux de reboisement","lisible":true}';
    await crawlResults(
      deps({
        extractAvisText: async () => noticeWithEstimation,
        storeResult: async (r) => (stored.push(r), true),
      }),
      { delayMs: 0 },
    );
    expect(stored[0]?.estimationMad).toBe(1_000_000);
    expect(stored[0]?.objet).toBe('travaux de reboisement');
  });

  it('skips consultations without a result notice', async () => {
    const s = await crawlResults(
      deps({ fetchDetail: async () => detailNoNotice('REF/111') }),
      { delayMs: 0 },
    );
    expect(s.notices).toBe(0);
    expect(s.extracted).toBe(0);
  });

  it('skips an illegible notice', async () => {
    const s = await crawlResults(
      deps({ extractAvisText: async () => '{"lisible":false}' }),
      { delayMs: 0 },
    );
    expect(s.notices).toBe(2);
    expect(s.extracted).toBe(0);
  });

  it('counts a stored=false (duplicate) as extracted but not stored', async () => {
    const s = await crawlResults(
      deps({ storeResult: async () => false }),
      { delayMs: 0 },
    );
    expect(s.extracted).toBe(2);
    expect(s.stored).toBe(0);
  });

  it('counts errors and keeps going', async () => {
    const s = await crawlResults(
      deps({
        fetchAvisBytes: async () => {
          throw new Error('download failed');
        },
      }),
      { delayMs: 0 },
    );
    expect(s.errors).toBe(2);
    expect(s.extracted).toBe(0);
  });

  it('respects maxResults', async () => {
    const s = await crawlResults(deps({}), { delayMs: 0, maxResults: 1 });
    expect(s.resultsFound).toBe(1);
  });

  it('OCR-then-text-LLM path: invokes extractAvisText with the raw bytes', async () => {
    // The wiring contract is: fetchAvisBytes returns the avis bytes verbatim,
    // then extractAvisText receives THOSE bytes (not a base64 string + media
    // type as the old vision path did). Asserting on the %PDF prefix pins the
    // contract so a future refactor can't silently revert to a base64 hand-off.
    const seen: Uint8Array[] = [];
    await crawlResults(
      deps({
        fetchAvisBytes: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        extractAvisText: async (bytes) => {
          seen.push(bytes);
          return readable('STE ALPHA');
        },
      }),
      { delayMs: 0 },
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]?.[0]).toBe(0x25); // %
    expect(seen[0]?.[1]).toBe(0x50); // P
    expect(seen[0]?.[2]).toBe(0x44); // D
    expect(seen[0]?.[3]).toBe(0x46); // F
  });
});
