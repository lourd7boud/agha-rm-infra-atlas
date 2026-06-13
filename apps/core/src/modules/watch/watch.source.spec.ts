import { describe, expect, test, vi } from 'vitest';
import { HttpPortalSource, PradoPortalSource } from './watch.source';

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

describe('PradoPortalSource (Atexo MPE stateful pagination)', () => {
  const pradoPage = (
    pagestate: string,
    refs: readonly string[],
    withNext: boolean,
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
    return (
      `<html><body>` +
      `<input type="hidden" name="PRADO_PAGESTATE" value="${pagestate}" />` +
      `<input type="text" name="ctl0$CONTENU_PAGE$resultSearch$numPageTop" value="1" />` +
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

  test('rejects a non-http(s) portal URL at construction', () => {
    expect(() => new PradoPortalSource('file:///etc/passwd')).toThrow(/http/i);
  });
});
