export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  pollingIntervalSeconds: number;
}

export interface DeviceAccessToken {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
  refreshExpiresInSeconds?: number;
  tokenType: string;
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface OidcDeviceAuthorizationClientOptions {
  issuerUrl: string;
  clientId: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
}

export type DeviceAuthorizationPrompt = (authorization: DeviceAuthorization) => Promise<void>;

type JsonRecord = Record<string, unknown>;

const defaultSleep: Sleep = (milliseconds, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Device authorization aborted'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Device authorization aborted'));
      },
      { once: true },
    );
  });

function stringField(body: JsonRecord, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveNumberField(body: JsonRecord, field: string): number | undefined {
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function responseJson(response: Response): Promise<JsonRecord> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as JsonRecord;
    }
  } catch {
    // Normalized below without exposing provider response bodies or tokens.
  }
  throw new Error('OIDC provider returned a malformed response');
}

export class OidcDeviceAuthorizationClient {
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly scope: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(options: OidcDeviceAuthorizationClientOptions) {
    const issuer = new URL(options.issuerUrl);
    const loopback = issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1';
    if (issuer.protocol !== 'https:' && !(loopback && issuer.protocol === 'http:')) {
      throw new Error('OIDC device authorization requires HTTPS outside loopback development');
    }
    if (!options.clientId.trim()) throw new Error('OIDC client ID is required');
    this.issuerUrl = issuer.toString().replace(/\/$/, '');
    this.clientId = options.clientId;
    this.scope = options.scope ?? 'openid profile email';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async start(signal?: AbortSignal): Promise<DeviceAuthorization> {
    const form = new URLSearchParams({ client_id: this.clientId, scope: this.scope });
    const response = await this.fetchImpl(
      `${this.issuerUrl}/protocol/openid-connect/auth/device`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: signal ?? AbortSignal.timeout(30_000),
      },
    );
    const body = await responseJson(response);
    if (!response.ok) throw new Error('OIDC device authorization could not be started');
    const deviceCode = stringField(body, 'device_code');
    const userCode = stringField(body, 'user_code');
    const verificationUri = stringField(body, 'verification_uri');
    const expiresIn = positiveNumberField(body, 'expires_in');
    if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
      throw new Error('OIDC provider returned a malformed device authorization response');
    }
    const interval = positiveNumberField(body, 'interval') ?? 5;
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: stringField(body, 'verification_uri_complete'),
      expiresAt: this.now() + expiresIn * 1_000,
      pollingIntervalSeconds: interval,
    };
  }

  async waitForToken(
    authorization: DeviceAuthorization,
    signal?: AbortSignal,
  ): Promise<DeviceAccessToken> {
    let pollingIntervalSeconds = Math.max(1, authorization.pollingIntervalSeconds);
    while (this.now() < authorization.expiresAt) {
      await this.sleep(pollingIntervalSeconds * 1_000, signal);
      if (this.now() >= authorization.expiresAt) break;
      const form = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: authorization.deviceCode,
        client_id: this.clientId,
      });
      const response = await this.fetchImpl(`${this.issuerUrl}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: signal ?? AbortSignal.timeout(30_000),
      });
      const body = await responseJson(response);
      if (response.ok) return this.parseToken(body);

      const error = stringField(body, 'error');
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        pollingIntervalSeconds += 5;
        continue;
      }
      if (error === 'access_denied') throw new Error('OIDC device authorization was denied');
      if (error === 'expired_token') break;
      throw new Error('OIDC device authorization failed');
    }
    throw new Error('OIDC device authorization expired');
  }

  async refresh(refreshToken: string, signal?: AbortSignal): Promise<DeviceAccessToken> {
    if (!refreshToken) throw new Error('OIDC refresh token is required');
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    const response = await this.fetchImpl(`${this.issuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    const body = await responseJson(response);
    if (!response.ok) throw new Error('OIDC signer session could not be refreshed');
    return this.parseToken(body);
  }

  /**
   * Produces the token supplier consumed by PortalSigningClient. Access and refresh
   * tokens stay in this process only and concurrent callers share one auth/refresh.
   */
  createAccessTokenProvider(
    prompt: DeviceAuthorizationPrompt,
    signal?: AbortSignal,
  ): () => Promise<string> {
    let state:
      | {
          accessToken: string;
          accessExpiresAt: number;
          refreshToken?: string;
          refreshExpiresAt?: number;
        }
      | undefined;
    let inFlight: Promise<string> | undefined;

    const obtain = async (): Promise<string> => {
      const now = this.now();
      if (state && state.accessExpiresAt - 30_000 > now) return state.accessToken;

      if (
        state?.refreshToken &&
        (!state.refreshExpiresAt || state.refreshExpiresAt - 30_000 > now)
      ) {
        try {
          const refreshed = await this.refresh(state.refreshToken, signal);
          state = {
            accessToken: refreshed.accessToken,
            accessExpiresAt: this.now() + refreshed.expiresInSeconds * 1_000,
            refreshToken: refreshed.refreshToken ?? state.refreshToken,
            refreshExpiresAt: refreshed.refreshExpiresInSeconds
              ? this.now() + refreshed.refreshExpiresInSeconds * 1_000
              : state.refreshExpiresAt,
          };
          return state.accessToken;
        } catch {
          state = undefined;
        }
      }

      const authorization = await this.start(signal);
      await prompt(authorization);
      const token = await this.waitForToken(authorization, signal);
      state = {
        accessToken: token.accessToken,
        accessExpiresAt: this.now() + token.expiresInSeconds * 1_000,
        refreshToken: token.refreshToken,
        refreshExpiresAt: token.refreshExpiresInSeconds
          ? this.now() + token.refreshExpiresInSeconds * 1_000
          : undefined,
      };
      return state.accessToken;
    };

    return async () => {
      if (!inFlight) {
        inFlight = obtain().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    };
  }

  private parseToken(body: JsonRecord): DeviceAccessToken {
    const accessToken = stringField(body, 'access_token');
    const expiresIn = positiveNumberField(body, 'expires_in');
    const tokenType = stringField(body, 'token_type');
    if (!accessToken || !expiresIn || !tokenType) {
      throw new Error('OIDC provider returned a malformed token response');
    }
    return {
      accessToken,
      expiresInSeconds: expiresIn,
      refreshToken: stringField(body, 'refresh_token'),
      refreshExpiresInSeconds: positiveNumberField(body, 'refresh_expires_in'),
      tokenType,
    };
  }
}
