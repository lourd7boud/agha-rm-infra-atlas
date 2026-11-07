export { auth as middleware } from '@/auth';

export const config = {
  // Everything is protected except auth, the public sign-in page, and static/
  // brand assets. Office previews are now converted locally behind the normal
  // authenticated API instead of exposing a temporary public download. `lf/`
  // holds the bundled
  // marketplace catalogue images (apps/web/public/lf) — public static assets, so
  // they serve without an auth round-trip like brand/ and issuers/.
  matcher: [
    '/((?!api/auth(?:/|$)|login(?:/|$)|issuers(?:/|$)|lf(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\.ico$|icon\.svg$|brand(?:/|$)).*)',
  ],
};
