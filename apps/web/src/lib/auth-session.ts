export interface AtlasSessionLike {
  user?: { name?: string | null; email?: string | null };
  accessToken?: string;
  error?: 'RefreshAccessTokenError';
}

export interface AtlasTokenLike {
  [key: string]: unknown;
}

export interface KeycloakLogoutInput {
  issuer?: string;
  clientId?: string;
  idToken?: string;
  postLogoutRedirectUri: string;
}

export function isUsableSession<T extends AtlasSessionLike>(
  session: T | null | undefined,
): session is T & { user: NonNullable<T['user']>; accessToken: string } {
  return Boolean(
    session?.user &&
      session.accessToken &&
      session.error !== 'RefreshAccessTokenError',
  );
}

export function sanitizedRefreshFailure(_token: AtlasTokenLike): AtlasTokenLike {
  return { error: 'RefreshAccessTokenError' };
}

export function buildKeycloakLogoutUrl(input: KeycloakLogoutInput): string | null {
  const { issuer, clientId, idToken, postLogoutRedirectUri } = input;
  if (!issuer || !clientId || !idToken) return null;

  try {
    const issuerUrl = new URL(issuer);
    const returnUrl = new URL(postLogoutRedirectUri);
    if (
      !['http:', 'https:'].includes(issuerUrl.protocol) ||
      !['http:', 'https:'].includes(returnUrl.protocol)
    ) {
      return null;
    }
    const logoutUrl = new URL(
      `${issuerUrl.toString().replace(/\/+$/, '')}/protocol/openid-connect/logout`,
    );
    logoutUrl.searchParams.set('id_token_hint', idToken);
    logoutUrl.searchParams.set('client_id', clientId);
    logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    return logoutUrl.toString();
  } catch {
    return null;
  }
}
