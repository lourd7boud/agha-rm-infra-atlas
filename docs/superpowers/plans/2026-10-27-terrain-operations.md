# Terrain Operations Implementation Plan

**Goal:** Turn the existing Terrain workspace into a trustworthy daily construction workflow, preserving existing project modules and data.
**Architecture:** Keep existing resource tables as operational records. Add a versioned daily-work aggregate with transactional submission/review, shared typed contracts, and a mobile-first editor. Maintain a single financial snapshot and explicit data-quality warnings.
**Tech Stack:** NestJS, Drizzle/PostgreSQL, Next.js 15, React 19, Zod, Vitest, Playwright.
**Spec:** Approved council decision in this chat, 2026-10-27.

## Global constraints
- Preserve all pre-existing uncommitted edits. Do not push, deploy remotely, or change authentication settings.
- Work on codex/terrain-operations in the current checkout so existing local work is retained.
- Reuse Personnel assignments, BPU lines, resource tables, measurements and existing design tokens.
- Missing costs are unknown, never proof of profitability. Do not invent physical progress or client approval.
- Project-scoped writes, optimistic concurrency, replay-safe review, and auditable corrections.
- New additive migrations only; do not rewrite historical financial values without evidence.

## Tasks / ownership
- [x] T1 finance: btp-terrain.domain.ts, btp-terrain.repository.ts, financial regression tests, migration 0053. Latest live decompte rather than MAX; snapshot labour costs; explicitly separate ambiguous expense totals from operational costs and suppress unqualified margin.
- [x] T2 daily backend: packages/contracts/src/terrain.ts, new btp-journee domain/repository/controller/module and tests, new schema/terrain.ts, migration 0054. Draft/submitted/reviewed/returned lifecycle; optimistic version; atomic idempotent materialization to existing resources on review; source links and audit; blockers owner/due/status; retain unknown valuations.
- [x] T3 frontend: TerrainTabs.tsx (preserve current edits), new daily editor/server action files, btp-shared.ts, project page navigation. Strong overview/action queue, shared daily input, collective attendance, production, materials, equipment, expenses, blockers, photo references; local drafts and visible sync/conflict state.
- [x] T4 integration (coordinator): provider/schema/contract exports, migration journal, real attachment-to-measurement linking, authorization integration, regression tests, local migration and live verification.
- [x] T5 reviews: independent TypeScript/security review, fix findings, targeted tests/typechecks/build and browser verification.

## Interface decisions
- Daily route: /btp/projects/:projectId/terrain/journees; GET list; PUT /:id with {expectedVersion,payload}; POST /:id/submit, /:id/return, /:id/review with expectedVersion (return also reason).
- UUID client id and optimistic expectedVersion=0 create. Existing record same version required; transitions reject stale clients. Shared contracts own exact payload and record types.
- Reviewed daily records are immutable; internal review is not client approval. Correct through an auditable replacement/reversal flow, never silently overwrite accepted resources.
- Root owns registration files and migration journal. Workers never edit each other's files or commit unrelated changes.

## Review focus / verification
- Newer lower-valued or deleted decompte must not cause divergent header/terrain values.
- Missing resource rates, repeated expenses, or mixed tax basis must never produce a green profit claim.
- Retried review/submission and concurrent clients must not duplicate resources or overwrite changes.
- Cross-project assignment, photo, BPU and measurement identifiers must be rejected.
- Network errors/local-storage failures must preserve input and show actionable recovery.

## Execution ledger
Ruling: use current checkout on a dedicated branch instead of a clean worktree — many relevant uncommitted changes belong to the user's active system; a clean worktree would omit them.
Ruling: execution was explicitly authorized after the approved council — no additional planning confirmation is needed.
Preflight: T1 and T2 share labour snapshot SQL contract; T1 defines nullable cost_snapshot_mad, T2 writes it on materialization. T2 produces shared daily contracts consumed by T3. Root alone registers modules and journals migrations. T1 and T3 share financial response contract, to be communicated before UI finalization.

Completion evidence (2026-10-28): additive migrations 0053–0057 applied to the local database; 79 targeted PostgreSQL-backed core tests and 108 web tests pass; core/web typechecks and the production web build pass; the live Playwright journey passes against localhost for overview, production, mobile layout, button contrast, offline draft recovery, and horizontal-overflow protection.
Review evidence: independent TypeScript/security review findings were resolved, including measurement-link idempotency, period locking, temporary-labour valuation, reconciliation concurrency/audit retention, and production rounding.
Scope note: the complete core suite has two pre-existing unrelated failures in the portal caution parser/crawler; no portal files were changed. Offline support deliberately covers recoverable form drafts, not queued photo upload. Profit and total cost remain unavailable until expenses and resource valuations are fully reconciled.
Delivery: the local core and web containers are healthy and serve the completed Terrain workspace at the project URL. Existing unrelated working-tree edits were preserved; nothing was pushed or deployed remotely.
