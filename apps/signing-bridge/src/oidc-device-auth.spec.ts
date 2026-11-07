import { describe, expect, it, vi } from 'vitest';

import { OidcDeviceAuthorizationClient } from './oidc-device-auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OIDC device authorization', () => {
  it('starts a device flow and polls until the signer authorizes it', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'http://localhost:18081/realms/atlas/device',
          verification_uri_complete:
            'http://localhost:18081/realms/atlas/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'short-lived-access-token',
          expires_in: 300,
          refresh_token: 'refresh-secret',
          refresh_expires_in: 1800,
          token_type: 'Bearer',
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = new OidcDeviceAuthorizationClient({
      issuerUrl: 'http://localhost:18081/realms/atlas',
      clientId: 'atlas-signing-bridge',
      fetchImpl,
      sleep,
      now: () => 1_000,
    });

    const authorization = await client.start();
    const token = await client.waitForToken(authorization);

    expect(authorization.userCode).toBe('ABCD-EFGH');
    expect(token.accessToken).toBe('short-lived-access-token');
    expect(sleep).toHaveBeenCalledWith(5_000, undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const tokenBody = String(fetchImpl.mock.calls[1]?.[1]?.body);
    expect(tokenBody).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
    );
    expect(tokenBody).toContain('client_id=atlas-signing-bridge');
  });

  it('backs off when the provider asks the bridge to slow down', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, 400))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'token', expires_in: 300, token_type: 'Bearer' }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = new OidcDeviceAuthorizationClient({
      issuerUrl: 'https://id.example.test/realms/atlas',
      clientId: 'atlas-signing-bridge',
      fetchImpl,
      sleep,
      now: () => 1_000,
    });

    await client.waitForToken({
      deviceCode: 'device-secret',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://id.example.test/device',
      expiresAt: 601_000,
      pollingIntervalSeconds: 5,
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 5_000, undefined);
    expect(sleep).toHaveBeenNthCalledWith(2, 10_000, undefined);
  });

  it('fails closed on denial, insecure remote issuers and malformed replies', async () => {
    expect(
      () =>
        new OidcDeviceAuthorizationClient({
          issuerUrl: 'http://id.example.test/realms/atlas',
          clientId: 'atlas-signing-bridge',
        }),
    ).toThrow(/HTTPS/);

    const denied = new OidcDeviceAuthorizationClient({
      issuerUrl: 'https://id.example.test/realms/atlas',
      clientId: 'atlas-signing-bridge',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: 'access_denied' }, 400),
      ),
      sleep: async () => undefined,
      now: () => 1_000,
    });
    await expect(
      denied.waitForToken({
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://id.example.test/device',
        expiresAt: 601_000,
        pollingIntervalSeconds: 5,
      }),
    ).rejects.toThrow(/denied/i);

    const malformed = new OidcDeviceAuthorizationClient({
      issuerUrl: 'https://id.example.test/realms/atlas',
      clientId: 'atlas-signing-bridge',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ expires_in: 600 })),
    });
    await expect(malformed.start()).rejects.toThrow(/malformed/i);
  });

  it('keeps tokens in memory, reuses them, then refreshes before expiry', async () => {
    let now = 1_000;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://id.example.test/device',
          expires_in: 600,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'token-1',
          expires_in: 60,
          refresh_token: 'refresh-1',
          refresh_expires_in: 600,
          token_type: 'Bearer',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'token-2',
          expires_in: 300,
          token_type: 'Bearer',
        }),
      );
    const client = new OidcDeviceAuthorizationClient({
      issuerUrl: 'https://id.example.test/realms/atlas',
      clientId: 'atlas-signing-bridge',
      fetchImpl,
      sleep: async () => undefined,
      now: () => now,
    });
    const onAuthorization = vi.fn(async () => undefined);
    const provider = client.createAccessTokenProvider(onAuthorization);

    await expect(provider()).resolves.toBe('token-1');
    await expect(provider()).resolves.toBe('token-1');
    now = 40_000;
    await expect(provider()).resolves.toBe('token-2');

    expect(onAuthorization).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const refreshBody = String(fetchImpl.mock.calls[2]?.[1]?.body);
    expect(refreshBody).toContain('grant_type=refresh_token');
    expect(refreshBody).toContain('refresh_token=refresh-1');
  });
});
