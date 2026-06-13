export { auth as middleware } from '@/auth';

export const config = {
  // Everything is protected except the auth endpoints, the public sign-in
  // page, and static/brand assets (the login hero must load unauthenticated).
  matcher: [
    '/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.svg|brand/).*)',
  ],
};
