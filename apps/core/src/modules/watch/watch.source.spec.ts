import { describe, expect, test, vi } from 'vitest';
import { HttpPortalSource } from './watch.source';

const okResponse = (html: string) =>
  ({ ok: true, status: 200, text: async () => html }) as Response;
const errResponse = (status: number) =>
  ({ ok: false, status, text: async () => '' }) as Response;

describe('HttpPortalSource retry', () => {
  test('returns the page on the first successful fetch', async () => {
    const fetchImpl = vi.fn(async () => okResponse('<html>avis</html>'));
    const source = new HttpPortalSource('https://portal/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const page = await source.fetch();

    expect(page.html).toContain('avis');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('retries a transient failure then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse('<html>recovered</html>'));
    const source = new HttpPortalSource('https://portal/', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const page = await source.fetch();

    expect(page.html).toContain('recovered');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('propagates the last error after exhausting attempts', async () => {
    const fetchImpl = vi.fn(async () => errResponse(503));
    const source = new HttpPortalSource('https://portal/', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(source.fetch()).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('HttpPortalSource pagination', () => {
  const base =
    'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons&EnCours';

  test('returns the base URL unchanged when no page param is configured', () => {
    const source = new HttpPortalSource(base);
    expect(source.buildPageUrl(1)).toBe(base);
    expect(source.buildPageUrl(5)).toBe(base);
  });

  test('sets the page index from a 1-based page number', () => {
    const source = new HttpPortalSource(base, { pageParam: 'pageActuelle' });
    expect(source.buildPageUrl(1)).toContain('pageActuelle=1');
    expect(source.buildPageUrl(3)).toContain('pageActuelle=3');
  });

  test('honors a non-default first page index', () => {
    const source = new HttpPortalSource(base, {
      pageParam: 'p',
      firstPageIndex: 0,
    });
    expect(source.buildPageUrl(1)).toContain('p=0');
    expect(source.buildPageUrl(2)).toContain('p=1');
  });

  test('appends the results-per-page parameter once', () => {
    const source = new HttpPortalSource(base, {
      pageParam: 'p',
      pageSizeParam: 'tailleResultParPage',
      pageSize: 500,
    });
    const url = source.buildPageUrl(2);
    expect(url).toContain('tailleResultParPage=500');
    expect(url).toContain('p=2');
    // Existing query keys survive.
    expect(url).toContain('page=entreprise.EntrepriseAdvancedSearch');
  });

  test('fetches the page-specific URL', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url);
      return okResponse('<html>page</html>');
    });
    const source = new HttpPortalSource(base, {
      pageParam: 'pageActuelle',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await source.fetch(4);

    expect(seen[0]).toContain('pageActuelle=4');
  });

  test('never emits "=NaN" to the portal on a poisoned firstPageIndex', () => {
    const source = new HttpPortalSource(base, {
      pageParam: 'pageActuelle',
      firstPageIndex: Number.NaN,
    });
    // firstPageIndex falls back to 1; the URL stays clean.
    expect(source.buildPageUrl(2)).toContain('pageActuelle=2');
    expect(source.buildPageUrl(2)).not.toContain('NaN');
  });

  test('rejects a non-http(s) portal URL at construction', () => {
    expect(() => new HttpPortalSource('file:///etc/passwd')).toThrow(/http/i);
    expect(() => new HttpPortalSource('ftp://portal/data')).toThrow(/http/i);
  });
});
