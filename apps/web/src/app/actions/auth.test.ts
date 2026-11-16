import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: state.auth, signOut: state.signOut }));
vi.mock('next/headers', () => ({ headers: state.headers }));
vi.mock('next/navigation', () => ({ redirect: state.redirect }));

import { logoutFromAtlas } from './auth';

describe('logoutFromAtlas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_URL', 'https://atlas.example.test');
    vi.stubEnv('AUTH_KEYCLOAK_ID', 'atlas-web');
    vi.stubEnv('AUTH_KEYCLOAK_ISSUER', 'https://atlas.example.test/auth/realms/atlas');
    vi.stubEnv('AUTH_KEYCLOAK_BROWSER_ISSUER', '');
    state.auth.mockResolvedValue({
      issuer: 'https://atlas.example.test/auth/realms/atlas',
      idToken: 'signed.id.token',
    });
    state.signOut.mockResolvedValue(undefined);
    state.headers.mockResolvedValue(new Headers({ host: 'untrusted.example.test' }));
  });

  afterEach(() => vi.unstubAllEnvs());

  test.each(['localhost', '127.0.0.1', '[::1]'])(
    'ends Keycloak SSO on a production build served over local HTTP at %s',
    async (host) => {
      vi.stubEnv('AUTH_URL', `http://${host}:13001`);
      await logoutFromAtlas();
      expect(state.signOut).toHaveBeenCalledWith({ redirect: false });
      expect(state.redirect.mock.calls[0][0]).toMatch(/^https?:\/\//);
      const url = new URL(state.redirect.mock.calls[0][0]);
      expect(url.pathname).toBe('/auth/realms/atlas/protocol/openid-connect/logout');
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`http://${host}:13001/login`);
      expect(state.signOut.mock.invocationCallOrder[0]).toBeLessThan(state.redirect.mock.invocationCallOrder[0]);
    },
  );

  test('uses the browser issuer even when an older refreshed session contains an internal issuer', async () => {
    vi.stubEnv('AUTH_KEYCLOAK_BROWSER_ISSUER', 'http://localhost:18081/realms/atlas');
    state.auth.mockResolvedValue({
      issuer: 'http://host.docker.internal:18081/realms/atlas',
      idToken: 'signed.id.token',
    });
    await logoutFromAtlas();
    expect(new URL(state.redirect.mock.calls[0][0]).origin).toBe('http://localhost:18081');
  });

  test('uses the canonical HTTPS deployment URL instead of request headers', async () => {
    await logoutFromAtlas();
    const url = new URL(state.redirect.mock.calls[0][0]);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://atlas.example.test/login');
    expect(state.headers).not.toHaveBeenCalled();
  });

  test.each(['', 'http://atlas.example.test', 'javascript:alert(1)', 'invalid-url'])(
    'clears the local session without trusting request headers for invalid production AUTH_URL %s',
    async (origin) => {
      vi.stubEnv('AUTH_URL', origin);
      await logoutFromAtlas();
      expect(state.signOut).toHaveBeenCalledWith({ redirect: false });
      expect(state.redirect).toHaveBeenCalledWith('/login');
      expect(state.headers).not.toHaveBeenCalled();
    },
  );

  test('clears an unusable local session even when there is no ID token for RP logout', async () => {
    state.auth.mockResolvedValue(null);
    await logoutFromAtlas();
    expect(state.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(state.redirect).toHaveBeenCalledWith('/login');
  });
});
