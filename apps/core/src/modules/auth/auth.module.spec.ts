import { describe, expect, test } from 'vitest';
import { keycloakJwksUrl } from './auth.module';

describe('keycloakJwksUrl', () => {
  test('uses an internal JWKS origin while preserving the public token issuer', () => {
    expect(
      keycloakJwksUrl(
        'http://localhost:18081/realms/atlas',
        'http://host.docker.internal:18081/realms/atlas',
      ).toString(),
    ).toBe(
      'http://host.docker.internal:18081/realms/atlas/protocol/openid-connect/certs',
    );
  });
});
