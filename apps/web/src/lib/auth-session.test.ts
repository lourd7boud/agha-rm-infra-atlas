import { describe, expect, test } from 'vitest';
import {
  buildKeycloakLogoutUrl,
  isUsableSession,
  sanitizedRefreshFailure,
} from './auth-session';

describe('isUsableSession', () => {
  test('accepts a user only when a usable access token is present', () => {
    expect(
      isUsableSession({ user: { name: 'Direction Generale' }, accessToken: 'access-token' }),
    ).toBe(true);
    expect(isUsableSession({ user: { name: 'Direction Generale' } })).toBe(false);
    expect(isUsableSession({ accessToken: 'access-token' })).toBe(false);
    expect(isUsableSession(null)).toBe(false);
  });

  test('rejects a stale identity after Keycloak refresh fails', () => {
    expect(
      isUsableSession({
        user: { name: 'Direction Generale' },
        accessToken: 'stale-token',
        error: 'RefreshAccessTokenError',
      }),
    ).toBe(false);
  });
});

describe('sanitizedRefreshFailure', () => {
  test('drops every credential and identity claim from an unusable JWT', () => {
    expect(
      sanitizedRefreshFailure({
        sub: 'keycloak-user-id',
        name: 'Direction Generale',
        email: 'dg@example.test',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: 123,
        issuer: 'https://atlas.example.test/auth/realms/atlas',
        roles: ['direction', 'marches'],
      }),
    ).toEqual({ error: 'RefreshAccessTokenError' });
  });
});

describe('buildKeycloakLogoutUrl', () => {
  test('builds a standards-based RP initiated logout URL', () => {
    const result = buildKeycloakLogoutUrl({
      issuer: 'https://atlas.example.test/auth/realms/atlas/',
      clientId: 'atlas-web',
      idToken: 'signed.id.token',
      postLogoutRedirectUri: 'https://atlas.example.test/login',
    });

    expect(result).not.toBeNull();
    const url = new URL(result!);
    expect(url.origin).toBe('https://atlas.example.test');
    expect(url.pathname).toBe('/auth/realms/atlas/protocol/openid-connect/logout');
    expect(url.searchParams.get('id_token_hint')).toBe('signed.id.token');
    expect(url.searchParams.get('client_id')).toBe('atlas-web');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://atlas.example.test/login',
    );
  });

  test('falls back to local logout when Keycloak configuration is incomplete', () => {
    expect(
      buildKeycloakLogoutUrl({
        issuer: undefined,
        clientId: 'atlas-web',
        idToken: 'signed.id.token',
        postLogoutRedirectUri: 'https://atlas.example.test/login',
      }),
    ).toBeNull();
    expect(
      buildKeycloakLogoutUrl({
        issuer: 'https://atlas.example.test/auth/realms/atlas',
        clientId: undefined,
        idToken: 'signed.id.token',
        postLogoutRedirectUri: 'https://atlas.example.test/login',
      }),
    ).toBeNull();
    expect(
      buildKeycloakLogoutUrl({
        issuer: 'https://atlas.example.test/auth/realms/atlas',
        clientId: 'atlas-web',
        idToken: undefined,
        postLogoutRedirectUri: 'https://atlas.example.test/login',
      }),
    ).toBeNull();
  });

  test('rejects non-HTTP issuer and return URL protocols', () => {
    expect(
      buildKeycloakLogoutUrl({
        issuer: 'javascript:alert(1)',
        clientId: 'atlas-web',
        idToken: 'signed.id.token',
        postLogoutRedirectUri: 'https://atlas.example.test/login',
      }),
    ).toBeNull();
    expect(
      buildKeycloakLogoutUrl({
        issuer: 'https://atlas.example.test/auth/realms/atlas',
        clientId: 'atlas-web',
        idToken: 'signed.id.token',
        postLogoutRedirectUri: 'javascript:alert(1)',
      }),
    ).toBeNull();
  });
});
