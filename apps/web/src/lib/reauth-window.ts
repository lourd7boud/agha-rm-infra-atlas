'use client';

import { buildReauthUrl } from '@/lib/session-check';

/**
 * Opens the Keycloak sign-in screen in a SMALL POPUP so the current page — its
 * route, its component state and every unsaved field — is never unmounted.
 *
 * A same-tab redirect to /login would destroy in-memory input the server never
 * received; a popup shares the origin, so completing SSO inside it lands the
 * session cookie on this page too, and the background watchdog simply picks the
 * usable session up again (no reload, no navigation, no toast).
 */
export const REAUTH_WINDOW_NAME = 'atlas-reauth';

export function openReauthWindow(): void {
  if (typeof window === 'undefined') return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const url = buildReauthUrl('/login', current);
  const popup = window.open(url, REAUTH_WINDOW_NAME, 'popup=yes,width=560,height=720');
  // Popup blocked: a new tab still keeps THIS page (and its input) alive.
  if (!popup || popup.closed) window.open(url, '_blank');
}
