import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface AuthConfig {
  providers: { options: { authorization: { params: Record<string, string> } } }[];
  callbacks: {
    jwt: (input: {
      token: Record<string, unknown>;
      account?: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
  };
}

const state = vi.hoisted(() => ({ nextAuth: vi.fn() }));
vi.mock('next-auth', () => ({ default: state.nextAuth }));

describe('Keycloak authentication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    state.nextAuth.mockReturnValue({});
    vi.stubEnv('AUTH_KEYCLOAK_ID', 'atlas-web');
    vi.stubEnv('AUTH_KEYCLOAK_ISSUER', 'http://localhost:18081/realms/atlas');
    vi.stubEnv('AUTH_KEYCLOAK_BROWSER_ISSUER', 'http://localhost:18081/realms/atlas');
    vi.stubEnv('AUTH_KEYCLOAK_SERVER_ISSUER', 'http://host.docker.internal:18081/realms/atlas');
    vi.stubEnv('AUTH_KEYCLOAK_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function config(): Promise<AuthConfig> {
    await import('./auth');
    return state.nextAuth.mock.calls[0][0] as AuthConfig;
  }

  test('asks for credentials on sign-in even if a previous Keycloak SSO session survives', async () => {
    const options = await config();
    expect(options.providers[0].options.authorization.params).toMatchObject({
      scope: 'openid profile email',
      prompt: 'login',
    });
  });

  test('refreshes over the internal endpoint without changing the public issuer used for logout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access-token',
      expires_in: 300,
    })));
    vi.stubGlobal('fetch', fetch);
    const options = await config();
    const refreshed = await options.callbacks.jwt({
      token: {
        issuer: 'http://localhost:18081/realms/atlas',
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        idToken: 'signed.id.token',
        expiresAt: 1,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://host.docker.internal:18081/realms/atlas/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(refreshed).toMatchObject({
      issuer: 'http://localhost:18081/realms/atlas',
      accessToken: 'new-access-token',
      idToken: 'signed.id.token',
    });
  });

  test('a browser-only endpoint override preserves the server endpoint across consecutive refreshes', async () => {
    vi.stubEnv('AUTH_KEYCLOAK_SERVER_ISSUER', '');
    vi.stubEnv('AUTH_KEYCLOAK_ISSUER', 'http://keycloak:8080/realms/atlas');
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      access_token: 'new-access-token',
      expires_in: 300,
    })));
    vi.stubGlobal('fetch', fetch);
    const options = await config();
    const refreshed = await options.callbacks.jwt({
      token: {
        issuer: 'http://keycloak:8080/realms/atlas',
        refreshToken: 'refresh-token',
        expiresAt: 1,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://keycloak:8080/realms/atlas/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(refreshed.issuer).toBe('http://localhost:18081/realms/atlas');
    await options.callbacks.jwt({ token: { ...refreshed, expiresAt: 1 } });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://keycloak:8080/realms/atlas/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
