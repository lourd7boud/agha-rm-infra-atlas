import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import { NextResponse, type NextRequest } from 'next/server';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    roles?: string[];
    error?: 'RefreshAccessTokenError';
  }
}

interface AtlasToken {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  issuer?: string;
  roles?: string[];
  error?: 'RefreshAccessTokenError';
  [key: string]: unknown;
}

const DEFAULT_KEYCLOAK_REALM = 'atlas';

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function resolveRequestOrigin(request?: NextRequest): string | undefined {
  if (!request) return undefined;
  try {
    return new URL(request.url).origin;
  } catch {
    return undefined;
  }
}

function resolvePublicOrigin(request?: NextRequest): string | undefined {
  const requestOrigin = resolveRequestOrigin(request);
  if (requestOrigin) return requestOrigin;

  const authUrl = trimEnv('AUTH_URL');
  if (!authUrl) return undefined;

  try {
    return new URL(authUrl).origin;
  } catch {
    return undefined;
  }
}

function resolveKeycloakRealm() {
  return trimEnv('AUTH_KEYCLOAK_REALM') ?? DEFAULT_KEYCLOAK_REALM;
}

function resolveKeycloakIssuer(request?: NextRequest): string | undefined {
  const explicitIssuer = trimEnv('AUTH_KEYCLOAK_ISSUER');
  const publicOrigin = resolvePublicOrigin(request);
  const fallbackIssuer = publicOrigin
    ? `${publicOrigin}/auth/realms/${resolveKeycloakRealm()}`
    : undefined;

  if (!explicitIssuer) return fallbackIssuer;

  try {
    const issuerUrl = new URL(explicitIssuer);
    if (
      process.env.NODE_ENV === 'production' &&
      fallbackIssuer &&
      isLoopbackHostname(issuerUrl.hostname)
    ) {
      return fallbackIssuer;
    }
  } catch {
    // Keep the explicit value below so mis-typed URLs still surface clearly.
  }

  return normalizeUrl(explicitIssuer);
}

function buildKeycloakProvider(request?: NextRequest) {
  const issuer = resolveKeycloakIssuer(request);
  const clientId = trimEnv('AUTH_KEYCLOAK_ID');
  const clientSecret = trimEnv('AUTH_KEYCLOAK_SECRET');

  if (!issuer || !clientId) {
    return Keycloak({
      issuer,
      clientId,
      clientSecret,
    });
  }

  const oidcBase = `${issuer}/protocol/openid-connect`;

  return Keycloak({
    issuer,
    clientId,
    clientSecret,
    authorization: {
      url: `${oidcBase}/auth`,
      params: { scope: 'openid profile email' },
    },
    token: { url: `${oidcBase}/token` },
    userinfo: { url: `${oidcBase}/userinfo` },
    client: {
      token_endpoint_auth_method: clientSecret ? 'client_secret_basic' : 'none',
    },
  });
}

function rolesFromAccessToken(accessToken: string): string[] {
  try {
    const payloadPart = accessToken.split('.')[1];
    if (!payloadPart) return [];
    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64').toString('utf8'),
    ) as { realm_access?: { roles?: unknown } };
    const roles = payload.realm_access?.roles;
    return Array.isArray(roles)
      ? roles.filter((role): role is string => typeof role === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Keycloak access tokens are short-lived (~5 min). Exchange the refresh
 * token for a fresh access token so server-side API calls never hit 401
 * mid-session. On failure the session carries an error flag and the next
 * apiGet/apiPost redirects to sign-in.
 */
async function refreshAccessToken(
  token: AtlasToken,
  fallbackIssuer?: string,
): Promise<AtlasToken> {
  const issuer = token.issuer ?? fallbackIssuer ?? resolveKeycloakIssuer();
  const clientId = process.env.AUTH_KEYCLOAK_ID;
  if (!issuer || !clientId || !token.refreshToken) {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
  try {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        ...(process.env.AUTH_KEYCLOAK_SECRET
          ? { client_secret: process.env.AUTH_KEYCLOAK_SECRET }
          : {}),
        refresh_token: token.refreshToken,
      }),
    });
    const refreshed = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !refreshed.access_token) {
      return { ...token, error: 'RefreshAccessTokenError' };
    }
    return {
      ...token,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 300),
      issuer,
      roles: rolesFromAccessToken(refreshed.access_token),
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth((request) => {
  const issuer = resolveKeycloakIssuer(request);

  return {
    providers: [buildKeycloakProvider(request)],
    secret: process.env.AUTH_SECRET,
    trustHost: process.env.AUTH_TRUST_HOST === 'true',
    session: { strategy: 'jwt' },
    pages: { signIn: '/login' },
    callbacks: {
      authorized({ request, auth: session }) {
        // Keycloak's OIDC endpoints are served under /auth/* on this same origin
        // by the reverse proxy (nginx → Keycloak), NEVER by Next.js. If such a
        // request reaches the app, the proxy dropped its /auth route and Next.js
        // renders a dead 404 mid-re-authentication — the "session ended, stuck on
        // a 404 instead of the login page" symptom. Bounce to the real sign-in
        // screen so the user always lands on /login, never a raw 404.
        if (request.nextUrl.pathname.startsWith('/auth/')) {
          return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
        }
        return Boolean(session?.user);
      },
      async jwt({ token, account }) {
        const t = token as AtlasToken;
        // Initial sign-in: capture access + refresh + expiry.
        if (account?.access_token) {
          return {
            ...t,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt:
              typeof account.expires_at === 'number'
                ? account.expires_at
                : Math.floor(Date.now() / 1000) + 300,
            issuer,
            roles: rolesFromAccessToken(account.access_token),
            error: undefined,
          };
        }
        // Still valid (60s safety margin): reuse.
        if (t.expiresAt && Date.now() / 1000 < t.expiresAt - 60) {
          return t;
        }
        // Expired: rotate via the refresh token.
        return refreshAccessToken(t, issuer);
      },
      session({ session, token }) {
        const t = token as AtlasToken;
        session.accessToken = t.accessToken;
        session.roles = t.roles ?? [];
        session.error = t.error;
        return session;
      },
    },
  };
});
