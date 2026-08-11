import { describe, expect, test, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth:
    (
      handler: (
        request: Request & { auth: Record<string, unknown> },
      ) => Response | Promise<Response>,
    ) =>
    async (request: Request) => {
      const authenticatedRequest = Object.assign(request, {
        auth: {
          user: { name: 'Direction Generale' },
          accessToken: 'private-access-token',
          idToken: 'private-id-token',
          issuer: 'https://atlas.example.test/auth/realms/atlas',
          roles: ['direction', 'marches'],
          expires: '2099-01-01T00:00:00.000Z',
        },
      });
      const response = await handler(authenticatedRequest);
      // Auth.js' request wrapper appends a rotated cookie after the custom
      // handler returns. The route must not replace or discard that response.
      response.headers.append(
        'Set-Cookie',
        'authjs.session-token=rotated; Path=/; HttpOnly; SameSite=Lax',
      );
      return response;
    },
}));

import { GET as sessionGet } from './session/route';
import { GET as statusGet } from './status/route';

type TestRoute = (request: Request) => Promise<Response>;

describe('redacted browser auth routes', () => {
  test('status returns only usability and preserves a rotated session cookie', async () => {
    const response = await (statusGet as TestRoute)(
      new Request('https://atlas.example.test/api/auth/status'),
    );

    expect(await response.json()).toEqual({ authenticated: true });
    expect(response.headers.get('set-cookie')).toContain('authjs.session-token=rotated');
  });

  test('public session never serializes Keycloak credentials', async () => {
    const response = await (sessionGet as TestRoute)(
      new Request('https://atlas.example.test/api/auth/session'),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      authenticated: true,
      user: { name: 'Direction Generale' },
      roles: ['direction', 'marches'],
    });
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('idToken');
    expect(body).not.toHaveProperty('issuer');
    expect(response.headers.get('set-cookie')).toContain('authjs.session-token=rotated');
  });
});
