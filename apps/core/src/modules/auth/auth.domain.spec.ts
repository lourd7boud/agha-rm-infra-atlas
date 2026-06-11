import { describe, expect, test } from 'vitest';
import { extractBearerToken, hasAnyRole, rolesFromPayload } from './auth.domain';

describe('extractBearerToken', () => {
  test('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  test('accepts case-insensitive scheme', () => {
    expect(extractBearerToken('bearer tok')).toBe('tok');
  });

  test('returns null when header is missing', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  test('returns null for non-bearer schemes', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  test('returns null when token part is empty', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('rolesFromPayload', () => {
  test('reads Keycloak realm roles', () => {
    const payload = { realm_access: { roles: ['direction', 'marches'] } };
    expect(rolesFromPayload(payload)).toEqual(['direction', 'marches']);
  });

  test('returns empty array when realm_access is missing', () => {
    expect(rolesFromPayload({})).toEqual([]);
  });

  test('returns empty array when roles is not an array', () => {
    expect(rolesFromPayload({ realm_access: { roles: 'direction' } })).toEqual([]);
  });

  test('filters out non-string entries', () => {
    const payload = { realm_access: { roles: ['terrain', 42, null] } };
    expect(rolesFromPayload(payload)).toEqual(['terrain']);
  });
});

describe('hasAnyRole', () => {
  test('passes when at least one required role is held', () => {
    expect(hasAnyRole(['terrain', 'marches'], ['direction', 'marches'])).toBe(true);
  });

  test('fails when no required role is held', () => {
    expect(hasAnyRole(['terrain'], ['direction', 'marches'])).toBe(false);
  });

  test('fails when user has no roles', () => {
    expect(hasAnyRole([], ['direction'])).toBe(false);
  });
});
