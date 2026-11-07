# Bid Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative, auditable participation workspace and replace the external submission escape hatch with an internal workflow entry point.

**Architecture:** Add a dedicated `bid` bounded context rather than extending `tender.pipeline_state`. Domain transition rules stay pure; a transactional repository atomically applies optimistic state changes and appends events. The web reads one workspace per company+tender and cannot claim submission without official receipt evidence.

**Tech Stack:** TypeScript, NestJS 11, Drizzle ORM/PostgreSQL, Zod, Next.js 15, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-bid-participation-platform.md`

## Global Constraints

- Never persist a private key, token PIN, portal password, session cookie or bearer token.
- `submitted` requires verified `official_receipt` evidence and cannot be reached by the generic transition command.
- Every mutation requires `expectedVersion` and is atomic with its event append.
- Authorization is company-scoped and restricted to `marches`, `direction`, or `admin-si`.
- Existing dirty workspace changes are preserved; no reset, stash or unrelated commit.

## Review Focus

- Two tabs transition the same workspace concurrently: one succeeds and one receives a version conflict.
- A client attempts to transition directly to `submitted`: the command is rejected without changing state or events.
- A tender receives a second workspace for the same company: the existing workspace is returned, not duplicated.
- An invalid or backward transition is rejected without an event append.
- An unauthenticated/missing development user receives a stable dev identity without weakening production role checks.

---

### Task 1: Shared lifecycle contract and pure domain rules

**Files:**
- Create: `packages/contracts/src/bid.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/core/src/modules/bid/bid.domain.ts`
- Test: `apps/core/src/modules/bid/bid.domain.spec.ts`

**Interfaces:**
- Produces: `BidWorkspaceState`, `bidWorkspaceStateSchema`, `assertBidTransition(from, to)`, `legalBidTargets(from)`.
- Consumes: none.

- [ ] Write failing tests for allowed preparation transitions, invalid transitions and the forbidden generic `submitted` transition.
- [ ] Run `pnpm --filter @atlas/core exec vitest run src/modules/bid/bid.domain.spec.ts` and confirm RED because the domain module does not exist.
- [ ] Implement the shared Zod state contract and pure transition rules.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Durable schema and forward migration

**Files:**
- Create: `apps/core/src/db/schema/bid.ts`
- Modify: `apps/core/src/db/schema.ts`
- Create: `apps/core/drizzle/0058_bid_workspace_foundation.sql`
- Modify: `apps/core/drizzle/meta/_journal.json`
- Test: `apps/core/src/modules/bid/bid.schema.spec.ts`

**Interfaces:**
- Consumes: `BidWorkspaceState` from Task 1.
- Produces: `bidWorkspaces`, `bidEvents`, `bidEvidence`, `bidPackageVersions`, `bidPackageFiles` tables and constraints.

- [ ] Write a schema contract test asserting company+tender uniqueness, non-negative versions and official-receipt evidence kind support.
- [ ] Run the focused test and confirm RED because the schema is absent.
- [ ] Add the additive schema and migration; all new columns are safe for an empty new table.
- [ ] Run the focused test and typecheck.

### Task 3: Transactional repository and workspace service

**Files:**
- Create: `apps/core/src/modules/bid/bid.repository.ts`
- Create: `apps/core/src/modules/bid/bid.service.ts`
- Test: `apps/core/src/modules/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 transition rules and Task 2 schema.
- Produces: `BidWorkspaceService.start`, `.getByTender`, `.transition`; `BidWorkspaceRepository` with in-memory and Drizzle implementations.

- [ ] Write failing behavior tests for idempotent start, optimistic conflict, atomic event append, invalid transition and direct submission rejection.
- [ ] Run the focused test and confirm RED.
- [ ] Implement the service and in-memory repository, then the Drizzle transaction using `UPDATE ... WHERE version = expectedVersion` plus event append.
- [ ] Run the focused test and core typecheck.

### Task 4: Secured Bid API

**Files:**
- Create: `apps/core/src/modules/bid/bid.controller.ts`
- Create: `apps/core/src/modules/bid/bid.module.ts`
- Create: `apps/core/src/modules/bid/bid.controller.spec.ts`
- Modify: `apps/core/src/app.module.ts`

**Interfaces:**
- Consumes: `BidWorkspaceService` from Task 3 and authenticated request identity.
- Produces: `POST /bid/workspaces`, `GET /bid/workspaces/by-tender/:tenderId`, `GET /bid/workspaces/:id`, `POST /bid/workspaces/:id/transitions`.

- [ ] Write failing request/controller tests for Zod validation, caller identity propagation and version-conflict mapping.
- [ ] Run the focused test and confirm RED.
- [ ] Implement thin controller endpoints with `@Roles('marches','direction','admin-si')`.
- [ ] Register the module and run focused tests plus core typecheck.

### Task 5: Internal participation workspace UI

**Files:**
- Create: `apps/web/src/app/(app)/tenders/[id]/participation/page.tsx`
- Create: `apps/web/src/app/(app)/tenders/[id]/participation/BidWorkspacePanel.tsx`
- Create: `apps/web/src/lib/bid-workspace.ts`
- Test: `apps/web/src/lib/bid-workspace.test.ts`

**Interfaces:**
- Consumes: Task 4 API and Task 1 state values.
- Produces: internal workspace route, progress rail, next safe action and server actions for start/transition.

- [ ] Write failing tests for state labels, progress ordering and safe next actions.
- [ ] Run the focused web test and confirm RED.
- [ ] Implement the workflow view using the established ATLAS industrial visual system and accessible buttons.
- [ ] Run focused tests and web typecheck.

### Task 6: Replace the external submission escape hatch

**Files:**
- Modify: `apps/web/src/app/(app)/tenders/DetailDrawer.tsx`
- Modify: `apps/web/src/app/(app)/tenders/[id]/page.tsx`
- Test: `apps/web/src/lib/bid-workspace.test.ts`

**Interfaces:**
- Consumes: Task 5 internal route.
- Produces: every tender participation entry opens ATLAS; the legacy manual `submitted` action disappears.

- [ ] Extend the failing UI-domain test to prove there is no generic action targeting `submitted`.
- [ ] Replace `Soumission en ligne` with `Préparer la participation` linking to `/tenders/:id/participation`.
- [ ] Remove the legacy manual `Marquer soumis (G3)` action while preserving analytical tender states until migration.
- [ ] Run web tests, web typecheck, core tests and core typecheck.

### Task 7: Security and whole-slice verification

**Files:**
- Modify only files implicated by findings.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: a green, reviewed vertical slice ready for package/signing work.

- [ ] Verify no sensitive values are accepted by or logged from the new endpoints.
- [ ] Verify all mutation endpoints require roles and optimistic versions.
- [ ] Run `pnpm --filter @atlas/core test`, `pnpm --filter @atlas/web test`, `pnpm --filter @atlas/core typecheck`, and `pnpm --filter @atlas/web typecheck`.
- [ ] Record pre-existing failures separately; fix regressions caused by this plan.
