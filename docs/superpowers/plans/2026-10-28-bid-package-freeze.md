# Bid Package Assembly and Freeze Implementation Plan

> **Execution:** Apply test-driven development task by task. Keep every legal/evidence state behind a dedicated command.

**Goal:** Build a versioned bid package from verified Vault files and freeze an immutable, content-addressed manifest before any signing task can exist.

**Architecture:** Requirements belong to a workspace; package versions snapshot exact file bytes into a bid-owned storage prefix. Draft changes use optimistic workspace versions and append audit events. Freeze re-verifies every stored object, checks all mandatory requirements, hashes a canonical manifest, and atomically marks both package and workspace frozen.

**Tech Stack:** TypeScript, NestJS, Drizzle/PostgreSQL, S3/MinIO, Zod, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-bid-participation-platform.md`

## Invariants

- A package file is a byte snapshot, never a mutable pointer to a Vault document.
- A draft cannot freeze while any mandatory requirement is missing.
- Manifest serialization is canonical and deterministic.
- Freeze validates actual stored bytes against every recorded SHA-256.
- Frozen package rows and files are immutable; edits create a new version.
- `review -> frozen` is possible only through the freeze command, atomically with its event.
- Every mutation carries `expectedVersion`; stale tabs cannot attach or freeze.

### Task 1: Package contracts and pure manifest domain

**Files:** `packages/contracts/src/bid.ts`, `apps/core/src/modules/bid/bid-package.domain.ts`, tests.

- [ ] Add requirement, envelope, attach and freeze schemas.
- [ ] Test canonical ordering, missing requirements and manifest hash determinism.
- [ ] Implement pure completeness and manifest functions.

### Task 2: Durable requirements and Vault file metadata

**Files:** `apps/core/src/db/schema/bid.ts`, `apps/core/src/db/schema/vault.ts`, migration `0060`, schema tests, Vault repository/controller tests.

- [ ] Add package requirements and requirement-to-file linkage.
- [ ] Persist original filename and byte length for Vault uploads.
- [ ] Enforce current package ownership and immutable frozen metadata constraints.

### Task 3: Transactional package repository and service

**Files:** `bid-package.repository.ts`, `bid-package.service.ts`, tests.

- [ ] Snapshot Vault bytes under content-addressed bid keys.
- [ ] Create/reuse one draft, attach/replace one requirement file atomically, append events.
- [ ] Re-read bytes, validate completeness, calculate canonical manifest, freeze atomically.
- [ ] Test stale-version conflicts, tampered storage, missing requirements and successful freeze.

### Task 4: Secured API and operator UI

**Files:** Bid controller/module tests and participation UI.

- [ ] Add list package, seed requirements, attach Vault file and freeze endpoints.
- [ ] Render requirement checklist, selected immutable snapshots and freeze readiness.
- [ ] Never expose signing actions until the frozen manifest exists.

### Task 5: PostgreSQL integration and full verification

- [ ] Prove concurrent attach/freeze has one winner and audit rollback is atomic.
- [ ] Apply migration, run Core/Web suites and typechecks.
- [ ] Rebuild local Core/Web and smoke-test the internal route.
