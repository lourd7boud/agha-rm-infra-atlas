import { describe, expect, test, vi } from 'vitest';
import { PortalAuthSession, portalAuthConfigFromEnv } from './portal-auth';

/** Headers stub exposing getSetCookie(), like the WHATWG fetch Headers. */
const headers = (setCookies: readonly string[] = []) =>
  ({ getSetCookie: () => [...setCookies] }) as unknown as Headers;

const htmlResponse = (
  html: string,
  setCookies: readonly string[] = [],
): Response =>
  ({
    ok: true,
    status: 200,
    headers: headers(setCookies),
    text: async () => html,
  }) as Response;

/** Unauthenticated login page: the exact PRADO field names + hidden inputs. */
const LOGIN_PAGE =
  '<html><body>' +
  '<form action="index.php?page=entreprise.EntrepriseHome" method="post">' +
  'Par login et mot de passe' +
  '<input type="hidden" name="PRADO_PAGESTATE" value="STATE-GET" />' +
  '<input type="hidden" name="PRADO_PAGESTATE:0" value="0" />' +
  '<input type="hidden" name="ctl0$CONTENU_PAGE$visit" value="V1" />' +
  '<input type="text" name="ctl0$CONTENU_PAGE$login" value="" />' +
  '<input type="password" name="ctl0$CONTENU_PAGE$password" value="" />' +
  '<input type="image" name="ctl0$CONTENU_PAGE$authentificationButton" src="ok.gif" />' +
  '</form></body></html>';

/** Authenticated landing page: the logout link + welcome banner. */
const AUTHED_PAGE =
  '<html><body><a href="index.php?page=entreprise.EntrepriseDisconnect">' +
  'Déconnexion</a><h1>Bienvenue AGHID CONSTRUCTION</h1></body></html>';

/** Some protected page the caller wants behind the session. */
const PROTECTED_PAGE =
  '<html><body><a href="x">Déconnexion</a><table>data</table></body></html>';

const CREDS = { login: 'tester', password: 'secret-pw' } as const;

describe('portalAuthConfigFromEnv', () => {
  test('reads both credentials from the environment', () => {
    const config = portalAuthConfigFromEnv({
      PORTAL_AUTH_LOGIN: ' tester ',
      PORTAL_AUTH_PASSWORD: 'secret-pw',
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({ login: 'tester', password: 'secret-pw' });
  });

  test('throws a clear, password-free error when a credential is missing', () => {
    expect(() =>
      portalAuthConfigFromEnv({ PORTAL_AUTH_LOGIN: 'tester' } as NodeJS.ProcessEnv),
    ).toThrow(/PORTAL_AUTH_PASSWORD/);
  });

  test('does not leak the password value in the error', () => {
    expect(() =>
      portalAuthConfigFromEnv({
        PORTAL_AUTH_PASSWORD: 'secret-pw',
      } as NodeJS.ProcessEnv),
    ).toThrow(/PORTAL_AUTH_LOGIN/);
  });
});

describe('PortalAuthSession login', () => {
  test('replays hidden fields, sets both credentials, and POSTs the login form', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        return htmlResponse(AUTHED_PAGE, ['PHPSESSID=sess-2; Path=/']);
      }
      // The login GET serves the form; the authed protected GET serves data.
      return url.includes('protected')
        ? htmlResponse(PROTECTED_PAGE)
        : htmlResponse(LOGIN_PAGE, ['PHPSESSID=sess-1; Path=/']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    const html = await session.authedFetch('https://portal.test/protected');

    // GET login page, POST login, then the authed GET.
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.url).toContain('page=entreprise.EntrepriseHome');

    const body = calls[1]?.init?.body?.toString() ?? '';
    // Hidden PRADO inputs are replayed verbatim.
    expect(body).toContain('PRADO_PAGESTATE=STATE-GET');
    expect(body).toContain('ctl0%24CONTENU_PAGE%24visit=V1');
    // The two credentials are set.
    expect(body).toContain('ctl0%24CONTENU_PAGE%24login=tester');
    expect(body).toContain('ctl0%24CONTENU_PAGE%24password=secret-pw');
    // The postback target names the auth image button, parameter empty.
    expect(body).toContain(
      'PRADO_POSTBACK_TARGET=ctl0%24CONTENU_PAGE%24authentificationButton',
    );
    expect(body).toContain('PRADO_POSTBACK_PARAMETER=');
    // Defensive image-button click coordinates.
    expect(body).toContain('authentificationButton.x=1');
    expect(body).toContain('authentificationButton.y=1');

    expect(html).toBe(PROTECTED_PAGE);
  });

  test('captures the session cookie and reuses it on authedFetch', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        return htmlResponse(AUTHED_PAGE, ['PHPSESSID=sess-authed; Path=/']);
      }
      // GET: the login page (no cookie sent yet) vs. the protected page.
      return url.includes('protected')
        ? htmlResponse(PROTECTED_PAGE)
        : htmlResponse(LOGIN_PAGE, ['PHPSESSID=sess-get; Path=/']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    await session.authedFetch('https://portal.test/protected');

    // The protected GET carries the POST-rotated session cookie.
    const protectedCall = calls.find((c) => c.url.includes('protected'));
    const cookie = (protectedCall?.init?.headers as Record<string, string>)
      ?.Cookie;
    expect(cookie).toContain('PHPSESSID=sess-authed');
  });

  test('caches the cookie so a second authedFetch does not re-login', async () => {
    let logins = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        logins += 1;
        return htmlResponse(AUTHED_PAGE, ['PHPSESSID=s; Path=/']);
      }
      return url.includes('protected')
        ? htmlResponse(PROTECTED_PAGE)
        : htmlResponse(LOGIN_PAGE, ['PHPSESSID=g; Path=/']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    await session.authedFetch('https://portal.test/protected');
    await session.authedFetch('https://portal.test/protected');

    expect(logins).toBe(1);
  });

  test('throws a password-free error when login does not authenticate', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      // POST still returns the login form → authentication failed.
      return htmlResponse(LOGIN_PAGE, method === 'POST' ? [] : ['PHPSESSID=x']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    await expect(
      session.authedFetch('https://portal.test/protected'),
    ).rejects.toThrow(/login failed/i);
    await expect(
      session.authedFetch('https://portal.test/protected'),
    ).rejects.not.toThrow(/secret-pw/);
  });

  test('refuses to fetch a URL off the session origin (no cookie exfiltration)', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(LOGIN_PAGE, ['PHPSESSID=x']));
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    await expect(
      session.authedFetch('https://evil.example/steal'),
    ).rejects.toThrow(/off-origin/i);
    // It must reject BEFORE any network call (no login, no cookie sent anywhere).
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('PortalAuthSession session expiry', () => {
  test.each([false, true])('a login-form response triggers exactly one re-login (redirect=%s)', async redirect => {
    let logins = 0;
    let protectedHits = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        logins += 1;
        return htmlResponse(AUTHED_PAGE, [`PHPSESSID=sess-${logins}; Path=/`]);
      }
      if (url.includes('protected')) {
        protectedHits += 1;
        // First protected GET has expired (login form); second succeeds.
        if (protectedHits !== 1) return htmlResponse(PROTECTED_PAGE);
        if (redirect) return new Response(null, { status: 302, headers: { Location: '/index.php?page=entreprise.EntrepriseHome', 'Set-Cookie': 'PHPSESSID=anonymous-redirect; Path=/' } });
        return htmlResponse(LOGIN_PAGE, ['PHPSESSID=anonymous-renewal; Path=/']);
      }
      return htmlResponse(LOGIN_PAGE, ['PHPSESSID=get; Path=/']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    const html = await session.authedFetch('https://portal.test/protected');

    expect(html).toBe(PROTECTED_PAGE);
    expect(logins).toBe(2); // initial login + exactly one re-login
    expect(protectedHits).toBe(2); // expired hit + successful retry
  });

  test('gives up when the re-login still returns the login form', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        return htmlResponse(AUTHED_PAGE, ['PHPSESSID=s; Path=/']);
      }
      // Every protected GET is expired → re-login cannot restore the session.
      return url.includes('protected')
        ? htmlResponse(LOGIN_PAGE)
        : htmlResponse(LOGIN_PAGE, ['PHPSESSID=get; Path=/']);
    });
    const session = new PortalAuthSession({
      ...CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://portal.test/',
    });

    await expect(
      session.authedFetch('https://portal.test/protected'),
    ).rejects.toThrow(/session expired/i);
  });
});

describe('PortalAuthSession authenticated transport', () => {
  const origin = 'https://www.marchespublics.gov.ma';

  test('shares the authenticated cookie across a form, postback and binary response', async () => {
    const bytes = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(LOGIN_PAGE, { headers: { 'Set-Cookie': 'PHPSESSID=before' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: {
        Location: '/landing', 'Set-Cookie': 'PHPSESSID=signed-in',
      } }))
      .mockResolvedValueOnce(new Response(AUTHED_PAGE))
      .mockResolvedValueOnce(new Response(PROTECTED_PAGE, { headers: { 'Set-Cookie': 'PHPSESSID=form' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: {
        Location: '/file', 'Set-Cookie': 'PHPSESSID=file',
      } }))
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(new Response(PROTECTED_PAGE));
    const session = new PortalAuthSession({ ...CREDS, fetchImpl });
    const transport = await session.authenticatedTransport();
    await transport(`${origin}/dce`);
    const redirect = await transport(`${origin}/dce`, { method: 'POST', body: 'validate=1', redirect: 'follow', headers: { Cookie: 'PHPSESSID=caller' } });
    expect(redirect.status).toBe(302);
    const response = await transport(new URL(redirect.headers.get('location')!, origin));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await session.authedFetch(`${origin}/protected`);

    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', init?.redirect])).toEqual([
      [`${origin}/index.php?page=entreprise.EntrepriseHome`, 'GET', 'manual'],
      [`${origin}/index.php?page=entreprise.EntrepriseHome`, 'POST', 'manual'],
      [`${origin}/landing`, 'GET', 'manual'],
      [`${origin}/dce`, 'GET', 'manual'],
      [`${origin}/dce`, 'POST', 'manual'],
      [`${origin}/file`, 'GET', 'manual'],
      [`${origin}/protected`, 'GET', 'manual'],
    ]);
    expect(fetchImpl.mock.calls.slice(2).map(([, init]) => new Headers(init?.headers).get('cookie'))).toEqual([
      'PHPSESSID=signed-in', 'PHPSESSID=signed-in', 'PHPSESSID=form', 'PHPSESSID=file', 'PHPSESSID=file',
    ]);
  });

  test.each(['http://www.marchespublics.gov.ma/steal', 'https://www.marchespublics.gov.ma:444/steal', 'https://user:pw@www.marchespublics.gov.ma/steal', 'https://evil.example/steal'])(
    'refuses a disallowed authenticated URL before login and transport requests (%s)', async (url) => {
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(LOGIN_PAGE))
        .mockResolvedValueOnce(new Response(AUTHED_PAGE, { headers: { 'Set-Cookie': 'PHPSESSID=signed-in' } }));
      const session = new PortalAuthSession({ ...CREDS, fetchImpl });
      await expect(session.authedFetch(url)).rejects.toThrow(/off-origin/i);
      expect(fetchImpl).not.toHaveBeenCalled();
      const transport = await session.authenticatedTransport();
      await expect(transport(url)).rejects.toThrow(/off-origin/i);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  test('rejects an unsafe login redirect without sending credentials or cookies to it', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(LOGIN_PAGE, { headers: { 'Set-Cookie': 'PHPSESSID=before' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: {
        Location: 'https://evil.example/steal', 'Set-Cookie': 'PHPSESSID=signed-in',
      } }));
    const session = new PortalAuthSession({ ...CREDS, fetchImpl });
    await expect(session.authedFetch(`${origin}/protected`)).rejects.toThrow(/^Portal request refused: off-origin or invalid URL$/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rejects an unsafe withdrawal redirect before accepting its session cookie', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(LOGIN_PAGE))
      .mockResolvedValueOnce(new Response(AUTHED_PAGE, { headers: { 'Set-Cookie': 'PHPSESSID=signed-in' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: {
        Location: 'https://evil.example/steal', 'Set-Cookie': 'PHPSESSID=rejected',
      } }))
      .mockResolvedValueOnce(new Response(PROTECTED_PAGE));
    const session = new PortalAuthSession({ ...CREDS, fetchImpl });
    const transport = await session.authenticatedTransport();
    await expect(transport(`${origin}/dce`, { method: 'POST' })).rejects.toThrow(/off-origin/i);
    await transport(`${origin}/protected`);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchImpl.mock.calls[3]?.[1]?.headers).get('cookie')).toBe('PHPSESSID=signed-in');
  });
});
