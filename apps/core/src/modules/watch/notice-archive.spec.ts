import { describe, expect, test } from 'vitest';
import { InMemoryNoticeRepository } from '../intel/notice.repository';
import {
  archiveNotices,
  idAvisFromUrl,
  type NoticeArchiveDeps,
} from './notice-archive';

const LONG_TEXT = 'attributaire société alpha montant 1 234 567,89 DH '.repeat(10);

interface FakePage {
  links: Array<{ detailUrl: string; idAvis: string }>;
}

function makeDeps(
  pages: FakePage[],
  repo = new InMemoryNoticeRepository(),
  ocrQueue: string[] = [],
) {
  const byDetailUrl = new Map(
    pages.flatMap((p) => p.links.map((l) => [l.detailUrl, l] as const)),
  );
  let served = 0;
  const deps: NoticeArchiveDeps = {
    search: async () => ({ listingHtml: 'page:0', baseUrl: 'https://portal/' }),
    nextPage: async () => {
      served += 1;
      return served < pages.length
        ? { listingHtml: `page:${served}`, baseUrl: 'https://portal/' }
        : null;
    },
    extractLinks: (html) => {
      const index = Number(html.split(':')[1]);
      return (pages[index]?.links ?? []).map((l) => ({
        detailUrl: l.detailUrl,
        refConsultation: '1',
        orgAcronyme: 'x1x',
      }));
    },
    fetchDetail: async (url) => `detail:${url}`,
    extractAvisUrl: (detailHtml) => {
      const link = byDetailUrl.get(detailHtml.slice('detail:'.length));
      return link ? `https://portal/dl?idAvis=${link.idAvis}` : null;
    },
    parseReference: () => 'AO 1/2026',
    fetchAvisBytes: async () => new Uint8Array(64),
    // FIFO override queue lets a test hand specific OCR outputs to specific
    // notices (downloads are sequential, so order is deterministic).
    ocr: async () => ocrQueue.shift() ?? LONG_TEXT,
    notices: repo,
    sleep: async () => undefined,
  };
  return { deps, repo };
}

describe('idAvisFromUrl', () => {
  test('extracts the portal notice id', () => {
    expect(idAvisFromUrl('https://x/dl?a=1&idAvis=98765')).toBe('98765');
    expect(idAvisFromUrl('https://x/dl?a=1')).toBeNull();
  });
});

describe('archiveNotices', () => {
  test('archives fresh notices with OCR text', async () => {
    const { deps, repo } = makeDeps([
      {
        links: [
          { detailUrl: 'https://portal/d1', idAvis: '11' },
          { detailUrl: 'https://portal/d2', idAvis: '12' },
        ],
      },
    ]);
    const summary = await archiveNotices(deps, { annonceType: '5', maxNotices: 10 });
    expect(summary.acquired).toBe(2);
    expect(summary.errors).toBe(0);
    const rows = await repo.listByStatus('acquired', 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.annonceType).toBe('5');
    expect(rows[0]!.ocrText).toContain('attributaire');
  });

  test('short OCR output is archived as empty (never refetched, never LLM-fed)', async () => {
    const { deps, repo } = makeDeps(
      [{ links: [{ detailUrl: 'https://portal/d1', idAvis: '21' }] }],
      new InMemoryNoticeRepository(),
      ['too short'],
    );
    const summary = await archiveNotices(deps, { annonceType: '4', maxNotices: 5 });
    expect(summary.empty).toBe(1);
    expect(summary.acquired).toBe(0);
    expect(await repo.listByStatus('empty', 5)).toHaveLength(1);
  });

  test('skips already-archived detail URLs without refetching', async () => {
    const repo = new InMemoryNoticeRepository();
    await repo.insertAcquired({
      annonceType: '5',
      idAvis: '31',
      sourceUrl: 'https://portal/d1',
    });
    const { deps } = makeDeps(
      [
        {
          links: [
            { detailUrl: 'https://portal/d1', idAvis: '31' },
            { detailUrl: 'https://portal/d2', idAvis: '32' },
          ],
        },
      ],
      repo,
    );
    const summary = await archiveNotices(deps, { annonceType: '5', maxNotices: 10 });
    expect(summary.skippedKnown).toBe(1);
    expect(summary.acquired).toBe(1);
  });

  test('duplicate idAvis lands as duplicate, not error', async () => {
    const { deps } = makeDeps([
      {
        links: [
          { detailUrl: 'https://portal/d1', idAvis: '41' },
          { detailUrl: 'https://portal/d2', idAvis: '41' }, // same notice re-listed
        ],
      },
    ]);
    const summary = await archiveNotices(deps, { annonceType: '5', maxNotices: 10 });
    expect(summary.acquired).toBe(1);
    expect(summary.duplicates).toBe(1);
  });

  test('respects maxNotices and walks pages via nextPage', async () => {
    const { deps } = makeDeps([
      { links: [{ detailUrl: 'https://portal/a', idAvis: '51' }] },
      { links: [{ detailUrl: 'https://portal/b', idAvis: '52' }] },
      { links: [{ detailUrl: 'https://portal/c', idAvis: '53' }] },
    ]);
    const summary = await archiveNotices(deps, {
      annonceType: '5',
      maxNotices: 2,
      maxPages: 10,
    });
    expect(summary.acquired).toBe(2);
    expect(summary.pagesWalked).toBe(2);
  });

  test('a failing detail fetch counts an error and the run continues', async () => {
    const { deps } = makeDeps([
      {
        links: [
          { detailUrl: 'https://portal/broken', idAvis: '61' },
          { detailUrl: 'https://portal/ok', idAvis: '62' },
        ],
      },
    ]);
    const originalFetch = deps.fetchDetail;
    deps.fetchDetail = async (url) => {
      if (url.includes('broken')) throw new Error('HTTP 500');
      return originalFetch(url);
    };
    const summary = await archiveNotices(deps, { annonceType: '4', maxNotices: 10 });
    expect(summary.errors).toBe(1);
    expect(summary.acquired).toBe(1);
  });
});
