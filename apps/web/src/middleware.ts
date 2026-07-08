export { auth as middleware } from '@/auth';

export const config = {
  // Everything is protected except the auth endpoints, the token-gated public
  // file route (Microsoft Office viewer fetches it server-side, no cookie), the
  // public sign-in page, and static/brand assets. `lf/` holds the bundled
  // marketplace catalogue images (apps/web/public/lf) — public static assets, so
  // they serve without an auth round-trip like brand/ and issuers/.
  matcher: [
    '/((?!api/auth|api/public|login|issuers/|lf/|_next/static|_next/image|favicon.ico|icon.svg|brand/).*)',
  ],
};
