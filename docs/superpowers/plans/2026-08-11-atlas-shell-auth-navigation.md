# ATLAS Shell, Authentication, and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compact Gmail-like ATLAS sidebar, accessible top user/logout menu, isolated login layout, robust centralized Keycloak session handling, and permanent retirement of the standalone `/vault` UI.

**Architecture:** Keep the global root layout limited to document-wide assets, place login and protected UI in separate App Router route groups, and render the authenticated shell only after a reusable usable-session guard passes. Split the interactive shell into focused client components while retaining `RailNav` as the single navigation source and keeping Core Vault infrastructure untouched.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.7, Auth.js/NextAuth 5 beta, Keycloak OIDC, Tailwind CSS 4, Vitest 3, Playwright 1.60.

## Global Constraints

- Preserve the current ATLAS dark visual identity, colors, typography, icon style, and unrelated behavior.
- Preserve all pre-existing uncommitted accounting and sales edits, especially in `apps/web/src/app/layout.tsx` and `apps/web/src/components/nav/RailNav.tsx`.
- Desktop collapsed width is 72px and expanded overlay width is 264px with a 250ms ease-in-out transition.
- Touch layouts use a drawer; hover is never required for mobile navigation.
- Authentication checks remain centralized and reject missing access tokens and `RefreshAccessTokenError` sessions.
- Explicit logout clears Auth.js and initiates standards-based Keycloak RP logout.
- `/vault` permanently redirects to `/compta/legal` with status 308.
- Core Vault modules, storage, APIs, schemas, permissions, and shared document services remain unchanged.
- Production Keycloak configuration changes are documented but no remote administration is performed.

---

## File Structure

- Create `apps/web/src/lib/auth-session.ts`: pure usable-session and OIDC logout URL helpers.
- Create `apps/web/src/lib/auth-session.test.ts`: unit coverage for session and logout behavior.
- Modify `apps/web/src/auth.ts`: store ID token, sanitize failed refresh state, and use the centralized predicate.
- Create `apps/web/src/app/actions/auth.ts`: server logout action that clears Auth.js before Keycloak redirect.
- Reduce `apps/web/src/app/layout.tsx`: global HTML/body/fonts/CSS only.
- Create `apps/web/src/app/(auth)/layout.tsx`: standalone authentication layout.
- Move `apps/web/src/app/login/page.tsx` to `apps/web/src/app/(auth)/login/page.tsx`.
- Create `apps/web/src/app/(app)/layout.tsx`: protected layout, role visibility, and server/client shell boundary.
- Move all non-API protected UI routes into `apps/web/src/app/(app)/` without changing URLs.
- Create `apps/web/src/components/layout/AppShell.tsx`: interactive desktop/mobile shell composition.
- Create `apps/web/src/components/layout/UserMenu.tsx`: accessible dropdown.
- Modify `apps/web/src/components/nav/RailNav.tsx`: compact/expanded rendering, conditional tooltips, mobile navigation callback, and removal of `/vault`.
- Modify `apps/web/src/components/ui/Icon.tsx`: add menu and down-chevron icons using the existing hand-drawn style.
- Modify `apps/web/src/app/globals.css`: focused shell transitions/tooltips only where Tailwind state classes are insufficient.
- Modify `apps/web/next.config.ts`: 308 `/vault` redirect.
- Delete obsolete moved equivalents of `apps/web/src/app/vault/page.tsx` and `apps/web/src/app/vault/error.tsx`.
- Modify `platform/keycloak/atlas-realm.json`: allow registered post-logout redirects for the development client.
- Modify `platform/runbooks/staging-deploy.md`: production Keycloak post-logout configuration verification.
- Create `apps/web/e2e/app-shell.spec.ts`: acceptance coverage for desktop, logout, login isolation, redirect, and mobile drawer.

---

### Task 1: Central Session Validity and Logout URL Helpers

**Files:**
- Create: `apps/web/src/lib/auth-session.test.ts`
- Create: `apps/web/src/lib/auth-session.ts`
- Modify: `apps/web/src/auth.ts`

**Interfaces:**
- Produces: `isUsableSession(session: AtlasSessionLike | null | undefined): boolean`
- Produces: `buildKeycloakLogoutUrl(input: KeycloakLogoutInput): string | null`
- Produces: `sanitizedRefreshFailure(token: AtlasTokenLike): AtlasTokenLike`
- Consumes: Keycloak issuer, client ID, ID token, absolute post-logout URI.

- [ ] **Step 1: Write failing unit tests**

Test that usable sessions require user plus access token and no refresh error; failed refresh sanitization removes access, refresh, and ID tokens; logout URL contains the standard endpoint and encoded `id_token_hint`, `client_id`, and `post_logout_redirect_uri`; missing issuer/client returns `null`.

```ts
expect(isUsableSession({ user: { name: 'DG' }, accessToken: 'access' })).toBe(true);
expect(isUsableSession({ user: { name: 'DG' }, error: 'RefreshAccessTokenError' })).toBe(false);
expect(sanitizedRefreshFailure({ accessToken: 'a', refreshToken: 'r', idToken: 'i' }))
  .toEqual({ error: 'RefreshAccessTokenError' });
expect(new URL(buildKeycloakLogoutUrl(validInput)! ).pathname)
  .toBe('/realms/atlas/protocol/openid-connect/logout');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @atlas/web test -- src/lib/auth-session.test.ts`

Expected: FAIL because `auth-session.ts` and its exported helpers do not exist.

- [ ] **Step 3: Implement the pure helpers**

Use structural interfaces instead of importing NextAuth internals. Normalize trailing issuer slashes and construct URLs with `URL`/`searchParams`. Return only `{ error: 'RefreshAccessTokenError' }` from sanitization so stale credentials and identity claims are not retained.

- [ ] **Step 4: Integrate helpers into Auth.js**

Extend the local session/JWT declarations with `idToken`; capture `account.id_token` on sign-in; preserve it on successful refresh; call `sanitizedRefreshFailure` on all refresh failure paths; make `authorized` require `isUsableSession` while preserving the `/auth/*` proxy-failure redirect behavior.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```text
pnpm --filter @atlas/web test -- src/lib/auth-session.test.ts
pnpm --filter @atlas/web typecheck
```

Expected: PASS and zero TypeScript errors.

---

### Task 2: Separate Auth and Protected Route Layouts

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/(auth)/layout.tsx`
- Move: `apps/web/src/app/login/page.tsx` → `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(app)/layout.tsx`
- Move: protected page routes and root page/error into `apps/web/src/app/(app)/`
- Keep: `apps/web/src/app/api/**`, `apps/web/src/app/globals.css`, `apps/web/src/app/icon.svg`
- Modify: `apps/web/src/middleware.ts`

**Interfaces:**
- Consumes: `isUsableSession()` from Task 1.
- Produces: a minimal root document, standalone auth route tree, and protected AppShell route tree.

- [ ] **Step 1: Add a failing E2E assertion for login isolation**

In `apps/web/e2e/app-shell.spec.ts`, visit `/login` without authentication and assert the Connexion heading is visible while the global search, system status, sidebar navigation, ATLAS AI, and user menu are absent.

- [ ] **Step 2: Run the E2E test and verify RED when the local stack is available**

Run: `pnpm --filter @atlas/web test:e2e -- app-shell.spec.ts --grep "login is isolated"`

Expected on the current implementation: FAIL because a stale session can wrap login in the root App Shell. If the stack is unavailable, record the infrastructure error and continue with unit/type/build verification.

- [ ] **Step 3: Move routes into `(auth)` and `(app)` groups**

Use filesystem moves that preserve file contents and current uncommitted modifications. Route-group folder names do not alter public URLs. Do not move `api`, `globals.css`, or `icon.svg`.

- [ ] **Step 4: Reduce the root layout**

Keep metadata, font configuration, global CSS, `<html lang="fr">`, and `<body>`. Remove all session, navigation, shell, and logout logic.

- [ ] **Step 5: Implement route-group layouts**

`(auth)/layout.tsx` renders children without AppShell. `(app)/layout.tsx` calls `auth()`, redirects to `/login` unless `isUsableSession(session)`, computes existing `comptaVisible` and `salesVisible` role predicates, and renders `AppShell` with name, role, and permissions.

- [ ] **Step 6: Verify route compilation and login isolation**

Run:

```text
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/web build
```

Expected: both exit 0 with no duplicate route or layout errors.

---

### Task 3: Keycloak RP-Initiated Logout and Accessible User Menu

**Files:**
- Create: `apps/web/src/app/actions/auth.ts`
- Create: `apps/web/src/components/layout/UserMenu.tsx`
- Modify: `apps/web/src/components/ui/Icon.tsx`
- Modify: `platform/keycloak/atlas-realm.json`
- Modify: `platform/runbooks/staging-deploy.md`

**Interfaces:**
- Consumes: `auth()`, `signOut()`, and `buildKeycloakLogoutUrl()`.
- Produces: `logoutFromAtlas(): Promise<never>` server action.
- Produces: `UserMenu({ name, role, initials, logoutAction })` client component.

- [ ] **Step 1: Extend failing helper tests for safe fallback logout**

Assert that a valid Keycloak URL is returned with ID token and that missing Keycloak configuration produces `null`, allowing `/login` as the local-only fallback.

- [ ] **Step 2: Implement the server logout action**

Read the current session and request origin, build the Keycloak logout URL, call `await signOut({ redirect: false })`, then call Next.js `redirect(keycloakUrl ?? '/login')`. Never call `localStorage.clear()`.

- [ ] **Step 3: Implement `UserMenu`**

Use a button covering avatar/name/role/down chevron, `aria-haspopup="menu"`, `aria-expanded`, focus-visible styling, a positioned dark dropdown, document-level pointer outside handling, Escape handling, and a server-action logout form.

- [ ] **Step 4: Update Keycloak configuration and runbook**

Add the client attribute `"post.logout.redirect.uris": "+"` to the development realm. Add a production checklist item requiring `https://atlas.marocinfra.com/login` under Valid Post Logout Redirect URIs.

- [ ] **Step 5: Verify auth tests and configuration syntax**

Run:

```text
pnpm --filter @atlas/web test -- src/lib/auth-session.test.ts
Get-Content platform/keycloak/atlas-realm.json -Raw | ConvertFrom-Json | Out-Null
pnpm --filter @atlas/web typecheck
```

Expected: all commands exit 0.

---

### Task 4: Gmail-Like Desktop Sidebar and Mobile Drawer

**Files:**
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Modify: `apps/web/src/components/nav/RailNav.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/ui/Icon.tsx`

**Interfaces:**
- Consumes: `UserMenu`, `RailNav`, existing brand/icon components, and server-provided role visibility.
- Produces: `AppShellProps` with `children`, `name`, `role`, `comptaVisible`, `salesVisible`, and `logoutAction`.
- Extends: `RailNav` props with `expanded?: boolean` and `onNavigate?: () => void`.

- [ ] **Step 1: Add failing E2E interaction cases**

After login, assert desktop sidebar width is approximately 72px, active icon is visually marked, labels are absent, icon tooltip appears, hover expands to approximately 264px without changing the content column's left position, pointer leave collapses, and submenu state remains intact. Add a mobile viewport case asserting menu-button drawer open/close and navigation accessibility.

- [ ] **Step 2: Verify RED when integration services are available**

Run: `pnpm --filter @atlas/web test:e2e -- app-shell.spec.ts --grep "sidebar|mobile drawer"`

Expected: FAIL because the current desktop rail is permanently 256px and mobile uses horizontal navigation.

- [ ] **Step 3: Implement `AppShell` state and structure**

Track desktop pointer/focus expansion separately from mobile drawer state. Reserve `w-[72px]` in desktop layout and place a `w-[264px]` expanded aside over content with z-index, border, and restrained shadow. Preserve current search, status, notification, main content, compliance footer, brand, and role visibility.

- [ ] **Step 4: Adapt `RailNav`**

In compact mode render primary item icons and group icons only. Hide submenu text/items until expanded without resetting `marchesOpen` or `comptaOpen`. Render accessible custom tooltips only while compact. Keep the cyan active background and left indicator. Call `onNavigate` after mobile link activation.

- [ ] **Step 5: Implement mobile drawer**

Replace horizontal navigation with an explicit menu button, fixed backdrop and drawer, close button, Escape handling, body-scroll protection, and full expanded `RailNav`. Keep user menu available from the mobile header.

- [ ] **Step 6: Remove obsolete sidebar regions at source**

Do not render the ATLAS AI card, bottom avatar/profile, bottom logout form, their separators, or their spacing in `AppShell`.

- [ ] **Step 7: Run component compilation and E2E**

Run:

```text
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/web test:e2e -- app-shell.spec.ts --grep "sidebar|mobile drawer|user menu"
```

Expected: typecheck exits 0; E2E cases pass when the local integration stack is running.

---

### Task 5: Retire Standalone Documents & GED Navigation

**Files:**
- Modify: `apps/web/src/components/nav/RailNav.tsx`
- Modify: `apps/web/next.config.ts`
- Delete: moved legacy `apps/web/src/app/(app)/vault/page.tsx`
- Delete: moved legacy `apps/web/src/app/(app)/vault/error.tsx`
- Test: `apps/web/e2e/app-shell.spec.ts`

**Interfaces:**
- Produces: a single company-document navigation target, `/compta/legal`.
- Preserves: all `/api/vault/*` Core API and shared Vault infrastructure.

- [ ] **Step 1: Add failing navigation/redirect assertions**

Assert no visible `Documents & GED` link exists, `Statut légal & docs` targets `/compta/legal`, and direct `/vault` navigation resolves to `/compta/legal` without rendering the old heading.

- [ ] **Step 2: Verify RED**

Run the focused E2E grep for `vault redirect`; expect failure because `/vault` currently renders the old page.

- [ ] **Step 3: Remove the old navigation item and page**

Delete only the standalone web page/error boundary and the `ITEMS` entry. Do not alter Core imports or endpoints containing `vault` because the earlier dependency scan proved they are shared infrastructure.

- [ ] **Step 4: Add permanent Next.js redirect**

Add `async redirects()` returning `{ source: '/vault', destination: '/compta/legal', permanent: true }`, which emits 308 in Next.js.

- [ ] **Step 5: Re-scan all UI references**

Run:

```text
rg -n -i "Documents\s*&\s*GED|href=['\"]?/vault|destination:\s*['\"]?/vault" apps/web/src apps/web/e2e
rg -n "href=.?/compta/legal|destination:\s*'/compta/legal'" apps/web/src apps/web/next.config.ts
```

Expected: no old UI link; new legal destination remains. Core `/vault` API references are intentionally untouched.

---

### Task 6: Full Acceptance Verification and Cleanup

**Files:**
- Modify only files required to fix verification findings.
- Review all changed web files for unused imports/dead code.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: evidence-backed completion report.

- [ ] **Step 1: Inspect the final diff against pre-existing user changes**

Use `git diff -- apps/web platform/keycloak platform/runbooks` and confirm accounting/sales edits were preserved and unrelated Core files were not touched.

- [ ] **Step 2: Run static scans**

Run:

```text
rg -n -i "ATLAS AI|Documents\s*&\s*GED" apps/web/src
rg -n "Déconnexion|Deconnexion" apps/web/src
git diff --check
```

Expected: ATLAS AI and Documents & GED absent; Déconnexion appears only in UserMenu/auth-related tests; no whitespace errors.

- [ ] **Step 3: Run the complete web test suite**

Run: `pnpm --filter @atlas/web test`

Expected: all Vitest tests pass with zero failures.

- [ ] **Step 4: Run TypeScript and production build**

Run:

```text
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/web build
```

Expected: both exit 0 with no TypeScript, duplicate-route, or build errors.

- [ ] **Step 5: Run E2E acceptance tests**

Run: `pnpm --filter @atlas/web test:e2e -- app-shell.spec.ts`

Expected: all shell/auth/navigation cases pass when Web, Core, and Keycloak are available. Record exact infrastructure blockers otherwise.

- [ ] **Step 6: Request code and security review**

Review the complete diff for React/TypeScript correctness, accessibility, authentication bypasses, open redirects, token exposure, stale session behavior, and preservation of Vault infrastructure. Fix every Critical or Important finding and rerun affected verification.

- [ ] **Step 7: Produce the requested implementation report**

List modified/deleted files, sidebar mechanics, Auth Layout separation, Keycloak logout/expiry handling, every `/vault` replacement, build/test evidence, and future operational risks—especially production Keycloak Valid Post Logout Redirect URI configuration.
