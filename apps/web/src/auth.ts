import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

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
  roles?: string[];
  error?: 'RefreshAccessTokenError';
  [key: string]: unknown;
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
async function refreshAccessToken(token: AtlasToken): Promise<AtlasToken> {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
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
      roles: rolesFromAccessToken(refreshed.access_token),
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth: session }) {
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
          roles: rolesFromAccessToken(account.access_token),
          error: undefined,
        };
      }
      // Still valid (60s safety margin): reuse.
      if (t.expiresAt && Date.now() / 1000 < t.expiresAt - 60) {
        return t;
      }
      // Expired: rotate via the refresh token.
      return refreshAccessToken(t);
    },
    session({ session, token }) {
      const t = token as AtlasToken;
      session.accessToken = t.accessToken;
      session.roles = t.roles ?? [];
      session.error = t.error;
      return session;
    },
  },
});
