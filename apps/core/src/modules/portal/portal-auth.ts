import { cookieHeader, mergeCookieHeaders, PORTAL_UA, PORTAL_TIMEOUT } from '../watch/portal-fetch';
import { parseFormInputs } from '../watch/prado';

/**
 * Authenticated session layer for marchespublics.gov.ma (Atexo MPE / PRADO).
 *
 * Login is the ONLY write the portal sees — everything afterwards is a polite,
 * read-only GET carrying the captured session cookie. The form has no CAPTCHA
 * and no 2FA: it is a plain PRADO postback. We replay every parsed hidden input
 * verbatim (PRADO_PAGESTATE et al.), set the two credential fields and the
 * postback target for the authentication image button, then POST urlencoded.
 *
 * Success/failure is detected by content: an authenticated response no longer
 * contains the login prompt "Par login et mot de passe" and gains a
 * "Déconnexion" link. A later authed GET that comes back as the login form is
 * the session-expiry signal — we re-login once and retry.
 *
 * The password is a secret: it is never logged and is redacted from any error.
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
  private cookie: string | null = null;

  constructor(options: PortalAuthSessionOptions) {
    this.login = options.login;
    this.password = options.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
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
    if (!this.cookie) {
      this.cookie = await this.authenticate();
    }
    const html = await this.get(url, this.cookie);
    if (!isLoginForm(html)) return html;
    // Session expired: re-authenticate once, then retry.
    this.cookie = await this.authenticate();
    const retried = await this.get(url, this.cookie);
    if (isLoginForm(retried)) {
      throw new Error('Portal session expired and re-login did not restore it');
    }
    return retried;
  }

  /**
   * GET the login page, capture its session cookie + PRADO inputs, set the two
   * credentials and the postback target, then POST urlencoded. Returns the
   * session cookie on success; throws a clear (password-free) error otherwise.
   */
  private async authenticate(): Promise<string> {
    const loginUrl = new URL(LOGIN_PAGE_PATH, this.baseUrl).toString();

    const formRes = await this.fetchImpl(loginUrl, {
      headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
    });
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

    const postRes = await this.fetchImpl(loginUrl, {
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
      redirect: 'manual',
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
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
      const location = postRes.headers.get('location');
      if (!location) {
        throw new Error(
          `Portal login redirect missing Location for "${this.login}"`,
        );
      }
      const redirectUrl = new URL(location, loginUrl).toString();
      const redirectRes = await this.fetchImpl(redirectUrl, {
        headers: {
          'User-Agent': PORTAL_UA,
          Accept: 'text/html',
          Referer: loginUrl,
          Cookie: mergedCookie,
        },
        signal: AbortSignal.timeout(PORTAL_TIMEOUT),
      });
      sessionCookie = mergeCookieHeaders(
        mergedCookie,
        redirectRes.headers.getSetCookie(),
      );
      authedHtml = await redirectRes.text();
    } else {
      // Rare non-redirect path — some Atexo instances render the authed page
      // inline instead of 302ing. Keep the original single-shot behaviour.
      sessionCookie = mergedCookie;
      authedHtml = await postRes.text();
    }

    if (isLoginForm(authedHtml) || !authedHtml.includes(AUTHED_MARKER)) {
      // Never echo the password; identify the account only by login.
      throw new Error(`Portal login failed for "${this.login}"`);
    }
    return sessionCookie;
  }

  private async get(url: string, cookie: string): Promise<string> {
    const res = await this.fetchImpl(url, {
      headers: {
        'User-Agent': PORTAL_UA,
        Accept: 'text/html',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(PORTAL_TIMEOUT),
    });
    if (!res.ok) throw new Error(`Portal fetch failed: HTTP ${res.status}`);
    return res.text();
  }

  /** Reject any URL whose host differs from the authenticated origin. */
  private assertSameOrigin(url: string): void {
    if (new URL(url).host !== new URL(this.baseUrl).host) {
      throw new Error(
        `PortalAuthSession refuses to fetch off-origin (${new URL(url).host})`,
      );
    }
  }
}

/** True when the HTML is the unauthenticated login form (expiry signal). */
function isLoginForm(html: string): boolean {
  return html.includes(LOGIN_FORM_MARKER);
}
