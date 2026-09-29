'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { buildKeycloakLogoutUrl } from '@/lib/auth-session';

async function requestOrigin(): Promise<string | null> {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || process.env.NODE_ENV !== 'production') {
        return url.origin;
      }
    } catch {
      // Invalid deployment configuration fails closed below.
    }
  }

  // Production logout redirects must come from the canonical deployment URL,
  // never from a client-controlled Host header. Missing AUTH_URL therefore
  // degrades safely to local Auth.js logout and `/login`.
  if (process.env.NODE_ENV === 'production') return null;

  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    requestHeaders.get('host')?.trim();
  if (!host) return null;
  const protocol =
    requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    'http';
  if (protocol !== 'http' && protocol !== 'https') return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

export async function logoutFromAtlas(): Promise<void> {
  const [session, origin] = await Promise.all([auth(), requestOrigin()]);
  const keycloakLogoutUrl = origin
    ? buildKeycloakLogoutUrl({
        issuer: session?.issuer ?? process.env.AUTH_KEYCLOAK_ISSUER,
        clientId: process.env.AUTH_KEYCLOAK_ID,
        idToken: session?.idToken,
        postLogoutRedirectUri: new URL('/login', origin).toString(),
      })
    : null;

  // Auth.js owns the local HttpOnly session cookie. Clear it through its
  // server API before leaving the application for Keycloak RP logout.
  await signOut({ redirect: false });
  redirect(keycloakLogoutUrl ?? '/login');
}
