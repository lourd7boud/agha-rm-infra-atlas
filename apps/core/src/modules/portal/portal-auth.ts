import { cookieHeader, mergeCookieHeaders, PORTAL_UA, PORTAL_TIMEOUT } from '../watch/portal-fetch';
import { parseFormInputs } from '../watch/prado';

/**
 * Authenticated session layer for marchespublics.gov.ma (Atexo MPE / PRADO).
 *
 * The read-only harvests use authedFetch. A caller explicitly authorized to
 * withdraw a DCE can use authenticatedTransport for its PRADO postbacks and ZIP
 * response. Both paths keep the portal session cookie inside this client.
 *
 * Success/failure is detected by content: an authenticated response no longer
 * contains the login prompt "Par login et mot de passe" and gains a
 * "Déconnexion" link. A later authed GET that comes back as the login form is
 * the session-expiry signal — we re-login once and retry.
 *
 * Login errors contain neither credentials nor response content.
 */

const LOGIN_PAGE_PATH = 'index.php?page=entreprise.EntrepriseHome';
const LOGIN_FIELD = 'ctl0$CONTENU_PAGE$login';
const PASSWORD_FIELD = 'ctl0$CONTENU_PAGE$password';
const AUTH_BUTTON = 'ctl0$CONTENU_PAGE$authentificationButton';
const DEFAULT_BASE_URL = 'https://www.marchespublics.gov.ma/';

/** The login prompt only the unauthenticated page shows. */
const LOGIN_FORM_MARKER = 'Par login et mot de passe';
/** The logout link only an authenticated page shows. */
const AUTHED_MARKER = 'Déconnexion';

export interface PortalAuthConfig {
  login: string;
  password: string;
}

/**
 * Reads the portal credentials from the environment. Throws AT USE TIME (never
 * at import) with a clear, password-free message when either is missing, so a
 * misconfigured deploy fails loudly without leaking the secret.
 */
export function portalAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PortalAuthConfig {
  const login = env.PORTAL_AUTH_LOGIN?.trim();
  const password = env.PORTAL_AUTH_PASSWORD;
  const missing: string[] = [];
  if (!login) missing.push('PORTAL_AUTH_LOGIN');
  if (!password) missing.push('PORTAL_AUTH_PASSWORD');
  if (!login || !password) {
    throw new Error(
      `Portal authentication not configured: missing ${missing.join(', ')}`,
    );
  }
  return { login, password };
}

export interface PortalAuthSessionOptions {
  login: string;
  password: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Portal origin; the login page and authed URLs resolve against it. TEST-ONLY
   * override — production wiring MUST omit this so it defaults to the official
   * host. Never wire baseUrl from config or user input: the login POST body
   * (credentials) and the session cookie travel to whatever host this names.
   */
  baseUrl?: string;
}

/**
 * Lazy, self-renewing authenticated session. The first authedFetch triggers a
 * login; the cookie is cached and reused. A response that has reverted to the
 * login form re-authenticates exactly once before failing.
 */
export class PortalAuthSession {
  private readonly login: string;
  private readonly password: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly origin: string;
  private cookie: string | null = null;
  private loginGeneration = 0;
  private loginInFlight: Promise<string> | null = null;

  constructor(options: PortalAuthSessionOptions) {
    this.login = options.login;
    this.password = options.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.origin = new URL(this.baseUrl).origin;
  }

  /** Binary-capable same-origin transport for an explicitly authorized flow.
   * Redirects are returned to the caller. A postback is never replayed. */
  async authenticatedTransport(): Promise<typeof fetch> {
    await this.ensureCookie();
    return async (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('Cookie', this.cookie ?? '');
      const response = await this.request(input, { ...init, headers });
      if (response.status < 400) this.mergeSessionCookies(response);
      return response;
    };
  }

  /**
   * Authenticated GET. Logs in on first use, caches the cookie, and — when the
   * portal has expired the session and served the login form again — re-logs in
   * exactly once before retrying. Returns the page HTML.
   */
  async authedFetch(url: string): Promise<string> {
    // Defence in depth: only ever send the session cookie to the portal origin
    // this session authenticated against. Neutralises an env-injected off-origin
    // URL (e.g. a tampered MES_CAUTIONS_URL) from exfiltrating the cookie.
    this.assertSameOrigin(url);
    await this.ensureCookie();
    const generation = this.loginGeneration;
    const html = await this.get(url);
    if (!isLoginForm(html)) return html;
    // Session expired: re-authenticate once, then retry.
    if (this.loginGeneration === generation) this.cookie = null;
    await this.ensureCookie();
    const retried = await this.get(url);
    if (isLoginForm(retried)) {
      throw new Error('Portal session expired and re-login did not restore it');
    }
    return retried;
  }

  private async ensureCookie(): Promise<string> {
    if (this.cookie) return this.cookie;
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = this.authenticate();
    try {
      this.cookie = await this.loginInFlight;
      this.loginGeneration += 1;
      return this.cookie;
    } finally { this.loginInFlight = null; }
  }

  /**
   * GET the login page, capture its session cookie + PRADO inputs, set the two
   * credentials and the postback target, then POST urlencoded. Returns the
   * session cookie on success; throws a clear (password-free) error otherwise.
   */
  private async authenticate(): Promise<string> {
    const loginUrl = new URL(LOGIN_PAGE_PATH, this.baseUrl).toString();

    const formRes = await this.request(loginUrl, {
      headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
    });
    if (!formRes.ok) {
      await formRes.body?.cancel().catch(() => {});
      throw new Error(`Portal login form unavailable: HTTP ${formRes.status}`);
    }
    const getCookie = cookieHeader(formRes.headers.getSetCookie());
    const html = await formRes.text();

    const fields = parseFormInputs(html);
    const body = new URLSearchParams(fields);
    body.set(LOGIN_FIELD, this.login);
    body.set(PASSWORD_FIELD, this.password);
    body.set('PRADO_POSTBACK_TARGET', AUTH_BUTTON);
    body.set('PRADO_POSTBACK_PARAMETER', '');
    // The auth control is an image button — replay its .x/.y click coords too.
    body.set(`${AUTH_BUTTON}.x`, '1');
    body.set(`${AUTH_BUTTON}.y`, '1');

    const postRes = await this.request(loginUrl, {
      method: 'POST',
      headers: {
        'User-Agent': PORTAL_UA,
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginUrl,
        ...(getCookie ? { Cookie: getCookie } : {}),
      },
      body,
      // Manual redirect: PMMP replies with 302 Location=?page=…AccueilAuthentifie
      // and rotates the session cookie via Set-Cookie on that 302. Node fetch's
      // default follow does NOT re-inject those new cookies into the follow-up
      // GET, so authedHtml lands on the anonymous login form again and the
      // marker gate throws. Following manually with the merged cookies matches
      // what a browser (or curl -b/-c) does and is how the live P1 probe
      // authenticated from the same VPS.
    });

    // Merge the GET cookie (PHPSESSID captured on the form fetch) with any
    // rotated cookie the POST returned — Set-Cookie on the 302 carries the
    // now-authenticated principal. Uses name-aware dedup: the POST's fresh
    // PHPSESSID overwrites the anonymous one from the GET. Naive concat
    // sent both PHPSESSIDs and PMMP kept the first (anonymous) one, which
    // is why authedFetch was landing on the "vous devez être authentifié"
    // page even though the POST itself returned 302 correctly.
    const mergedCookie = mergeCookieHeaders(
      getCookie,
      postRes.headers.getSetCookie(),
    );

    let authedHtml: string;
    let sessionCookie: string;

    if (postRes.status >= 300 && postRes.status < 400) {
      const redirectUrl = this.redirectTarget(postRes, loginUrl);
      await postRes.body?.cancel().catch(() => {});
      const redirectRes = await this.request(redirectUrl, {
        headers: {
          'User-Agent': PORTAL_UA,
          Accept: 'text/html',
          Referer: loginUrl,
          Cookie: mergedCookie,
        },
      });
      if (!redirectRes.ok) {
        await redirectRes.body?.cancel().catch(() => {});
        throw new Error(`Portal login redirect failed: HTTP ${redirectRes.status}`);
      }
      sessionCookie = mergeCookieHeaders(
        mergedCookie,
        redirectRes.headers.getSetCookie(),
      );
      authedHtml = await redirectRes.text();
    } else {
      // Rare non-redirect path — some Atexo instances render the authed page
      // inline instead of 302ing. Keep the original single-shot behaviour.
      if (!postRes.ok) {
        await postRes.body?.cancel().catch(() => {});
        throw new Error(`Portal login failed: HTTP ${postRes.status}`);
      }
      sessionCookie = mergedCookie;
      authedHtml = await postRes.text();
    }

    if (!sessionCookie || isLoginForm(authedHtml) || !authedHtml.includes(AUTHED_MARKER)) {
      throw new Error('Portal login failed');
    }
    return sessionCookie;
  }

  private async get(url: string): Promise<string> {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await this.request(url, {
        headers: {
          'User-Agent': PORTAL_UA,
          Accept: 'text/html',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
      });
      if (response.ok) {
        const html = await response.text();
        if (!isLoginForm(html)) this.mergeSessionCookies(response);
        return html;
      }
      if (response.status >= 300 && response.status < 400) this.mergeSessionCookies(response);
      await response.body?.cancel().catch(() => {});
      if (response.status < 300 || response.status >= 400) {
        throw new Error(`Portal fetch failed: HTTP ${response.status}`);
      }
      url = this.redirectTarget(response, url);
    }
    throw new Error('Portal redirect limit exceeded');
  }

  private mergeSessionCookies(response: Response): void {
    this.cookie = mergeCookieHeaders(this.cookie ?? '', response.headers.getSetCookie());
  }

  private async request(input: URL | Request | string, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    this.assertSameOrigin(url);
    const response = await this.fetchImpl(input, {
      ...init,
      redirect: 'manual',
      signal: init?.signal ?? (input instanceof Request ? input.signal : AbortSignal.timeout(PORTAL_TIMEOUT)),
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      try { this.redirectTarget(response, url); }
      catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
    }
    return response;
  }

  private redirectTarget(response: Response, from: string): string {
    const location = response.headers.get('location');
    if (!location) throw new Error('Portal redirect missing Location');
    return this.assertSameOrigin(location, from).href;
  }

  private assertSameOrigin(value: string, from?: string): URL {
    let url: URL;
    try { url = new URL(value, from); }
    catch { throw new Error('Portal request refused: off-origin or invalid URL'); }
    if (url.origin !== this.origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) {
      throw new Error('Portal request refused: off-origin or invalid URL');
    }
    return url;
  }
}

/** True when the HTML is the unauthenticated login form (expiry signal). */
function isLoginForm(html: string): boolean {
  return html.includes(LOGIN_FORM_MARKER);
}
