import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import { NextResponse, type NextRequest } from 'next/server';
import {
  isUsableSession,
  sanitizedRefreshFailure,
} from '@/lib/auth-session';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    idToken?: string;
    issuer?: string;
    roles?: string[];
    error?: 'RefreshAccessTokenError';
  }
}

interface AtlasToken {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
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

/**
 * Browser-facing Keycloak issuer.
 *
 * In a containerized local stack (web + keycloak on the same Docker network)
 * the server-side issuer and the browser-side authorization URL CANNOT be the
 * same host: the web container reaches Keycloak via the Docker service name
 * (e.g. http://keycloak:8080) while the user's browser reaches it via the
 * host-published port (e.g. http://localhost:18081). A single issuer breaks
 * one of the two sides (server-side discovery/token ECONNREFUSED, or the
 * browser redirect to an unresolvable Docker hostname).
 *
 * Set AUTH_KEYCLOAK_BROWSER_ISSUER to override ONLY the authorization URL the
 * browser is redirected to. Falls back to the server-side issuer when unset,
 * which preserves the previous single-URL behaviour (production via a reverse
 * proxy serving /auth/* on the same origin).
 */
function resolveKeycloakBrowserIssuer(): string | undefined {
  const explicit = trimEnv('AUTH_KEYCLOAK_BROWSER_ISSUER');
  return explicit ? normalizeUrl(explicit) : undefined;
}

/**
 * Server-side Keycloak issuer — the URL the web CONTAINER uses to reach
 * Keycloak for discovery, token exchange and userinfo. In a split-issuer local
 * stack this differs from the browser issuer (Docker service name vs host
 * published port). Falls back to the browser issuer when unset, which preserves
 * the single-URL behaviour (production via a reverse proxy).
 */
function resolveKeycloakServerIssuer(): string | undefined {
  const explicit = trimEnv('AUTH_KEYCLOAK_SERVER_ISSUER');
  return explicit ? normalizeUrl(explicit) : undefined;
}

function resolveKeycloakIssuer(request?: NextRequest): string | undefined {
  const explicitIssuer = trimEnv('AUTH_KEYCLOAK_ISSUER');
  const publicOrigin = resolvePublicOrigin(request);
  const fallbackIssuer = publicOrigin
    ? `${publicOrigin}/auth/realms/${resolveKeycloakRealm()}`
    : undefined;

  if (!explicitIssuer) return fallbackIssuer;

  // When a separate browser issuer is configured (split-issuer local stack),
  // the explicit issuer is the browser-accessible URL and must be respected
  // as-is — the loopback override below would rewrite it to the public origin
  // which does NOT serve Keycloak in this topology.
  if (trimEnv('AUTH_KEYCLOAK_BROWSER_ISSUER')) {
    return normalizeUrl(explicitIssuer);
  }

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
  const serverIssuer = resolveKeycloakServerIssuer();
  const browserIssuer = resolveKeycloakBrowserIssuer();
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
  const serverOidcBase = serverIssuer
    ? `${serverIssuer}/protocol/openid-connect`
    : oidcBase;
  const browserOidcBase = browserIssuer
    ? `${browserIssuer}/protocol/openid-connect`
    : oidcBase;

  return Keycloak({
    issuer,
    clientId,
    clientSecret,
    // The `issuer` is the browser-accessible URL (used for `iss` claim
    // validation), but the web container reaches Keycloak via the Docker
    // service name. Override discovery to the server-side URL so the
    // container can actually fetch the OIDC configuration.
    ...(serverIssuer
      ? { wellKnown: `${serverIssuer}/.well-known/openid-configuration` }
      : {}),
    authorization: {
      url: `${browserOidcBase}/auth`,
      params: { scope: 'openid profile email' },
    },
    token: { url: `${serverOidcBase}/token` },
    userinfo: { url: `${serverOidcBase}/userinfo` },
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
  // The server-side issuer takes precedence: the web container reaches
  // Keycloak via the Docker service name, not the browser-accessible URL
  // stored in token.issuer.
  const serverIssuer = resolveKeycloakServerIssuer();
  const issuer =
    serverIssuer ?? token.issuer ?? fallbackIssuer ?? resolveKeycloakIssuer();
  const clientId = process.env.AUTH_KEYCLOAK_ID;
  if (!issuer || !clientId || !token.refreshToken) {
    return sanitizedRefreshFailure(token) as AtlasToken;
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
      id_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !refreshed.access_token) {
      return sanitizedRefreshFailure(token) as AtlasToken;
    }
    return {
      ...token,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      idToken: refreshed.id_token ?? token.idToken,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 300),
      issuer,
      roles: rolesFromAccessToken(refreshed.access_token),
      error: undefined,
    };
  } catch {
    return sanitizedRefreshFailure(token) as AtlasToken;
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
        return isUsableSession(session);
      },
      async jwt({ token, account }) {
        const t = token as AtlasToken;
        // Initial sign-in: capture access + refresh + expiry.
        if (account?.access_token) {
          return {
            ...t,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            idToken: account.id_token,
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
        session.idToken = t.idToken;
        session.issuer = t.issuer;
        session.roles = t.roles ?? [];
        session.error = t.error;
        return session;
      },
    },
  };
});
