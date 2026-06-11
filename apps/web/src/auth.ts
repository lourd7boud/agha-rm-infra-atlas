import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    roles?: string[];
  }
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
  session: { strategy: 'jwt' },
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
    jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.roles = rolesFromAccessToken(account.access_token);
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.roles = (token.roles as string[] | undefined) ?? [];
      return session;
    },
  },
});
