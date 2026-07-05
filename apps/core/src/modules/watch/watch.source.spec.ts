import { describe, expect, test, vi } from 'vitest';
import { HttpPortalSource, PradoPortalSource } from './watch.source';

const okResponse = (html: string) =>
  ({ ok: true, status: 200, text: async () => html }) as Response;
const okResponseWithCookies = (html: string, cookies: readonly string[]) =>
  ({
    ok: true,
    status: 200,
    text: async () => html,
    headers: { getSetCookie: () => [...cookies] },
  }) as unknown as Response;
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

describe('PradoPortalSource (Atexo MPE stateful pagination)', () => {
  const pradoPage = (
    pagestate: string,
    refs: readonly string[],
    withNext: boolean,
    opts: { withSizeSelect?: boolean } = {},
  ) => {
    const rows = refs
      .map(
        (r) =>
          `<tr><td><input type="checkbox" /></td><td>AOO Appel d'offres ouvert</td>` +
          `<td><a href="x?page=entreprise.EntrepriseDetailsConsultation&ref=${r}">${r}</a>` +
          ` - <span>Objet : truc</span></td><td>- Acheteur</td><td>15/07/202610:00</td>` +
          `<td></td><td>: 0 : 0</td></tr>`,
      )
      .join('');
    const next = withNext
      ? `<a id="ctl0_CONTENU_PAGE_resultSearch_PagerTop_ctl2" href="javascript:;">` +
        `<img src='x.gif' alt='Aller à la page suivante' title='Aller à la page suivante' /></a>`
      : '';
    // The Atexo "rows per page" select — present on the real result listing; its
    // postback is what the pageSize option drives.
    const sizeSelect = opts.withSizeSelect
      ? `<select name="ctl0$CONTENU_PAGE$resultSearch$listePageSizeTop">` +
        `<option selected value="10">10</option><option value="500">500</option></select>`
      : '';
    return (
      `<html><body>` +
      `<input type="hidden" name="PRADO_PAGESTATE" value="${pagestate}" />` +
      `<input type="text" name="ctl0$CONTENU_PAGE$resultSearch$numPageTop" value="1" />` +
      `${sizeSelect}` +
      `${next}` +
      `<table class="table-results"><tbody>${rows}</tbody></table>` +
      `</body></html>`
    );
  };

  test('GET first page, then POST the PRADO postback to advance', async () => {
    const page1 = pradoPage('STATE1', ['A/1', 'A/2'], true);
    const page2 = pradoPage('STATE2', ['B/1', 'B/2'], false);
    const calls: { method: string; body?: string }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: init?.body?.toString() });
      return okResponse(method === 'POST' ? page2 : page1);
    });
    const source = new PradoPortalSource('https://portal/search', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const p1 = await source.fetch(1);
    expect(p1.html).toContain('STATE1');
    expect(calls[0]?.method).toBe('GET');

    const p2 = await source.fetch(2);
    expect(p2.html).toContain('STATE2');
    expect(calls[1]?.method).toBe('POST');
    // Carries the captured state and the resolved next-page target.
    expect(calls[1]?.body).toContain('PRADO_PAGESTATE=STATE1');
    expect(calls[1]?.body).toContain(
      'PRADO_POSTBACK_TARGET=ctl0%24CONTENU_PAGE%24resultSearch%24PagerTop%24ctl2',
    );

    // Page 2 has no "next" link → the walk ends with an empty page.
    const p3 = await source.fetch(3);
    expect(p3.html).not.toContain('table-results');
  });

  test('does a single GET on the first hop when pageSize is unset', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(pradoPage('S', ['A/1'], true, { withSizeSelect: true })),
    );
    const source = new PradoPortalSource('https://portal/search', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await source.fetch(1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstInit = (fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1] as
      | RequestInit
      | undefined;
    expect(firstInit?.method ?? 'GET').toBe('GET');
  });

  test('switches the pager to pageSize via a postback on the first hop', async () => {
    const small = pradoPage('STATE10', ['A/1'], true, { withSizeSelect: true });
    const big = pradoPage('STATE500', ['B/1', 'B/2', 'B/3'], true, {
      withSizeSelect: true,
    });
    const calls: { method: string; body?: string }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: init?.body?.toString() });
      return okResponse(method === 'POST' ? big : small);
    });
    const source = new PradoPortalSource('https://portal/search', {
      pageSize: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const p1 = await source.fetch(1);

    // GET the listing, then POST the page-size postback, using the resized page.
    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toContain('listePageSizeTop=500');
    expect(calls[1]?.body).toContain(
      'PRADO_POSTBACK_TARGET=ctl0%24CONTENU_PAGE%24resultSearch%24listePageSizeTop',
    );
    expect(p1.html).toContain('STATE500');
  });

  test('skips the page-size postback when the size control is absent', async () => {
    // A listing with no listePageSizeTop control must not attempt a resize.
    const fetchImpl = vi.fn(async () =>
      okResponse(pradoPage('S', ['A/1'], true)),
    );
    const source = new PradoPortalSource('https://portal/search', {
      pageSize: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await source.fetch(1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('replays the captured session cookie on subsequent hops', async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers);
      const method = init?.method ?? 'GET';
      return method === 'POST'
        ? okResponse(pradoPage('S2', ['B/1'], false))
        : okResponseWithCookies(pradoPage('S1', ['A/1'], true), [
            'PHPSESSID=abc123; path=/; secure',
            'TS01fd=waf; Path=/',
          ]);
    });
    const source = new PradoPortalSource('https://portal/search', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await source.fetch(1);
    await source.fetch(2);

    const postHeaders = seen[1] as Record<string, string> | undefined;
    expect(postHeaders?.Cookie).toContain('PHPSESSID=abc123');
    expect(postHeaders?.Cookie).toContain('TS01fd=waf');
  });

  test('fails fast on a 429/403 block without retrying into it', async () => {
    // A WAF block must halt immediately — retrying hammers a live ban.
    const fetchImpl = vi.fn(async () => errResponse(429));
    const source = new PradoPortalSource('https://portal/search', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(source.fetch(1)).rejects.toThrow(/HTTP 429/);
    // One attempt only — no exponential-backoff retries into the block.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('still retries a transient 5xx with backoff', async () => {
    // A 503 is transient (overload), not a block: the existing retry applies.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse(pradoPage('S', ['A/1'], false)));
    const source = new PradoPortalSource('https://portal/search', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const page = await source.fetch(1);

    expect(page.html).toContain('table-results');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rejects a non-http(s) portal URL at construction', () => {
    expect(() => new PradoPortalSource('file:///etc/passwd')).toThrow(/http/i);
  });
});
