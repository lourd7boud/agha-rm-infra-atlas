export { auth as middleware } from '@/auth';

export const config = {
  // Everything is protected except the auth endpoints and static assets.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
