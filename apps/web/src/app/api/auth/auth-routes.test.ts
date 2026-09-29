import { beforeEach, describe, expect, test, vi } from 'vitest';

const USABLE_SESSION = {
  user: { name: 'Direction Generale' },
  accessToken: 'private-access-token',
  idToken: 'private-id-token',
  issuer: 'https://atlas.example.test/auth/realms/atlas',
  roles: ['direction', 'marches'],
  expires: '2099-01-01T00:00:00.000Z',
};

// `auth()` is called WITHOUT the `auth(handler)` wrapper on purpose: this app
// builds Auth.js from a lazy config, and the wrapper form throws inside a Route
// Handler (`Function.prototype.apply was called on #<Promise>`), which made both
// routes answer 500 — the exact defect that made the session watchdog treat a
// healthy session as expired.
const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('@/auth', () => ({
  auth: async () => state.session,
}));

import { GET as sessionGet } from './session/route';
import { GET as statusGet } from './status/route';

describe('redacted browser auth routes', () => {
  beforeEach(() => {
    state.session = USABLE_SESSION;
  });

  test('status reports usability without serializing any credential', async () => {
    const response = await statusGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ authenticated: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  test('status answers 401 (never 5xx) on an unusable session', async () => {
    for (const unusable of [
      null,
      { user: { name: 'Direction Generale' } },
      { ...USABLE_SESSION, error: 'RefreshAccessTokenError' },
    ]) {
      state.session = unusable;
      const response = await statusGet();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ authenticated: false });
    }
  });

  test('public session never serializes Keycloak credentials', async () => {
    const response = await sessionGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      authenticated: true,
      user: { name: 'Direction Generale' },
      roles: ['direction', 'marches'],
    });
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('idToken');
    expect(body).not.toHaveProperty('issuer');
  });

  test('public session answers 401 on an unusable session', async () => {
    state.session = { ...USABLE_SESSION, accessToken: undefined };
    const response = await sessionGet();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });
});
