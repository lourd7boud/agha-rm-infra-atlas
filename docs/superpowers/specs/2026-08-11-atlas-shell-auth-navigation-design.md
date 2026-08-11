# ATLAS OS Shell, Authentication, and Navigation Design

**Date:** 2026-08-11
**Status:** Approved for implementation planning

## Objective

Refine the existing ATLAS OS application shell without redesigning it: provide a Gmail-like responsive sidebar, move logout into the top user menu, separate authentication pages from the protected application layout, and retire the standalone Documents & GED entry in favor of `/compta/legal`.

The existing dark visual identity, typography, icons, colors, permissions, document storage services, and unrelated application behavior remain unchanged.

## Current Architecture and Root Causes

- `apps/web` is a Next.js 15 App Router application using Auth.js/NextAuth v5 with Keycloak OIDC.
- `apps/web/src/app/layout.tsx` currently owns the document root and the entire authenticated shell.
- The layout treats `session.user` as sufficient authentication. After a refresh-token failure, Auth.js can still expose stale user identity while marking the session with `RefreshAccessTokenError`; this causes the shell to wrap `/login`.
- `apps/web/src/middleware.ts` centralizes route protection, but its Auth.js `authorized` callback currently checks only whether a user exists.
- `apps/web/src/components/nav/RailNav.tsx` is the central navigation configuration and already contains locally modified accounting and sales navigation that must be preserved.
- The only standalone web UI references to the legacy company-document module are the `/vault` navigation entry and the `/vault` page/error boundary. Core Vault storage and document services are shared by tender, project, expert, accounting, and other modules and must remain intact.

## Chosen Architecture

Use App Router route groups to provide a real layout boundary:

```text
app/
  layout.tsx                 global document, fonts, and global CSS only
  (auth)/
    layout.tsx               authentication-only layout
    login/page.tsx           standalone login page
  (app)/
    layout.tsx               central protected-route guard and AppShell
    ...existing UI routes    URLs remain unchanged because route groups are omitted
  api/                       existing route handlers remain outside the UI groups
```

This avoids pathname-based hiding and prevents the application shell from being part of the `/login` render tree.

All protected UI routes remain covered by middleware and the `(app)` layout guard. Existing data-access checks remain as defense in depth because Next.js layouts may be preserved during client navigation.

## Authentication State

A single reusable session-validity predicate will define a usable session:

- a user exists;
- an access token exists;
- the session does not contain `RefreshAccessTokenError`.

The same rule will be applied by the protected layout and Auth.js `authorized` callback. The login page will redirect authenticated users to `/` only when the session is usable.

When Keycloak token refresh fails:

- access and refresh credentials are discarded from the JWT state;
- the unusable-session error remains available for routing decisions;
- middleware redirects protected requests to `/login`;
- the protected route group does not render `AppShell`;
- existing API helpers continue redirecting 401/unusable sessions to `/login`.

This prevents stale identity from being interpreted as authenticated state and avoids a flash of the protected shell around the login page.

## Keycloak Logout

Explicit logout will use OpenID Connect RP-Initiated Logout rather than only clearing browser storage:

1. Capture the Keycloak ID token from the Auth.js JWT created at sign-in.
2. Clear the Auth.js session through the installed server-side `signOut({ redirect: false })` API.
3. Redirect the browser to Keycloak's `/protocol/openid-connect/logout` endpoint.
4. Include `id_token_hint`, `client_id`, and an absolute `post_logout_redirect_uri` pointing to `/login`.
5. Configure the development Keycloak client to allow the post-logout redirect.

The post-logout route returns to the standalone login page. Since the local session cookie is removed before the Keycloak redirect and protected routes validate the full usable-session predicate, browser Back cannot restore a protected page without authentication.

Production Keycloak must have the matching Valid Post Logout Redirect URI configured. Repository configuration will document and cover the development realm; deployment verification must confirm the existing production client setting.

## App Shell Components

The authenticated shell will be extracted from the current root layout into maintainable components:

- `AppShell`: overall desktop/mobile shell and content/footer composition.
- `DesktopSidebar`: hover/focus expansion behavior and fixed collapsed layout slot.
- `MobileSidebar`: button-controlled modal drawer and backdrop.
- `UserMenu`: top-right accessible dropdown and logout action.
- `RailNav`: central navigation data and submenu state, adapted to compact/expanded rendering.

The existing top search, system health badge, notifications, user identity, compliance footer, brand assets, theme tokens, and role-based accounting/sales visibility are preserved.

## Desktop Sidebar Behavior

- The layout reserves approximately 72px for the collapsed rail.
- The sidebar itself expands as an overlay to approximately 264px.
- Expansion occurs on pointer hover and keyboard focus within the sidebar.
- Collapse occurs on pointer leave when focus is not retained inside the sidebar.
- Width, opacity, and shadow transitions use approximately 250ms ease-in-out.
- The expanded overlay receives the existing rail background, border, and a restrained shadow.
- Main dashboard content does not change width when the sidebar expands.

Collapsed mode shows:

- a compact ARMI/ATLAS mark;
- primary navigation icons;
- group icons for Marchés and Comptabilité;
- a clear cyan active background/indicator;
- a tooltip containing the destination label for each available icon.

Expanded mode shows the current full brand lockup, labels, section headings, submenu items, persisted submenu open state, and planned-module labels. Tooltips are suppressed while expanded.

The ATLAS AI status card and the bottom identity/logout section are removed from the shell source, including their spacing and separators.

## Mobile and Touch Behavior

The current horizontal navigation strip is replaced by an off-canvas drawer:

- an explicit menu button opens it;
- the drawer contains the full navigation with labels;
- a backdrop, close button, Escape handling, and focus management are provided;
- selecting a destination closes the drawer;
- hover is not required on touch devices.

The mobile header retains brand identity and exposes the same user menu/logout capability.

## User Menu Accessibility

The complete avatar/name/role area is a button with `aria-haspopup="menu"` and `aria-expanded`.

The dropdown:

- repeats avatar, user name, and current role/profile;
- contains the official `Déconnexion` action;
- opens by pointer or keyboard activation;
- closes on Escape, outside click, or completed navigation;
- provides visible focus states and menu semantics;
- visually follows the existing dark ATLAS surfaces and borders.

## Documents & GED Retirement

- Remove `Documents & GED` and `/vault` from the central `RailNav` configuration.
- Preserve `Statut légal & docs` at `/compta/legal` as the official company-document navigation destination.
- Preserve project/chantier-specific operational document links because they represent different domain functions.
- Remove the obsolete web `/vault` page and its route-specific error boundary.
- Add a Next.js configuration redirect:

```text
/vault -> /compta/legal (308 Permanent Redirect)
```

The redirect occurs before rendering the removed page, so there is no legacy-page flash. Authorization remains that of `/compta/legal` and its Core APIs.

No Core Vault module, database schema, object-storage adapter, upload/download API, permissions service, or shared document type will be removed.

## Testing Strategy

Implementation follows test-first changes where the current harness permits:

- Unit tests for the usable-session predicate, refresh-failure sanitization, and Keycloak logout URL construction.
- Navigation component tests ensuring `/vault` and `Documents & GED` are absent while `/compta/legal` remains.
- Interaction tests for desktop compact/expanded behavior, active items, conditional tooltips, submenu persistence, user-menu keyboard behavior, and mobile drawer state.
- E2E coverage for login isolation, authenticated shell rendering, explicit logout, old `/vault` redirect, and mobile navigation.
- Existing accounting legal-page behavior remains covered by build/type checking and an upload/download smoke path where the local integration stack is available.

Final verification commands:

```text
pnpm --filter @atlas/web test
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/web build
pnpm --filter @atlas/web test:e2e
```

If the external Core/Keycloak integration stack is unavailable, E2E tests will be reported separately as blocked rather than represented as passing.

## Change Boundaries

- Preserve all pre-existing uncommitted accounting and sales changes, including current edits in `layout.tsx` and `RailNav.tsx`.
- Do not modify unrelated routes, page designs, permissions, storage infrastructure, or Core business logic.
- Do not add CSS-only hiding for authentication separation.
- Do not duplicate navigation configuration.
- Remove unused imports and obsolete web components created by the legacy shell after verification.

## Acceptance Summary

Completion requires all requested desktop, mobile, authentication, logout, navigation, redirect, accessibility, and build checks to pass or to be explicitly reported with evidence when an external service prevents a test from running.
