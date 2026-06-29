export { auth as middleware } from '@/auth';

export const config = {
  // Everything is protected except the auth endpoints, the token-gated public
  // file route (Microsoft Office viewer fetches it server-side, no cookie), the
  // public sign-in page, and static/brand assets.
  matcher: [
    '/((?!api/auth|api/public|login|issuers/|_next/static|_next/image|favicon.ico|icon.svg|brand/).*)',
  ],
};
