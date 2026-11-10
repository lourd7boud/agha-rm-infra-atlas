# Métré Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the existing métré period page a practical, legible measurement workspace.

**Architecture:** Preserve the existing period route, Server Actions, calculation engine, section hierarchy and historical measurements. Add local navigation and editing assistance to the client editor, with a small pure helper module for summaries and search. No dependencies or schema changes.

**Tech Stack:** Next.js 15, React 19, TypeScript, existing Tailwind theme tokens, Vitest and Playwright.

**Spec:** User requests a substantial improvement in appearance and help entering data; user delegated design choices with “ابدأ باقتراحك”. This plan contains the design.

## Global Constraints

- French product copy, current light/dark theme, existing project and period scoping.
- Keep volume, surface, length, unit and steel calculations identical to Core, including deductions and element multipliers.
- Replace the dimensionally invalid sum of unlike quantities with estimated period HT = sum of rounded article quantities × unit price. Clearly label this as before revision/taxes/retention.
- Preserve explicit save and automatic décompte generation. No automatic financial writes or historical edits.

## Design

Use a restrained technical workspace: clear breadcrumb and period identity, grouped exports, muted settings panel, strong primary save action. A desktop article index provides direct navigation; a search/filter toolbar and expand/collapse controls help large bordereaux. Article headers show full descriptions, unit, current and previous quantities, cumulative progress and overruns.

Measurement tables use visible cell boundaries, alternating rows, clear focus, accessible field labels and number columns. Explain each unit's calculation; show calculated partials and incomplete-row hints. Add duplicate row, undo last deletion (until the next mutation), and Enter to advance/create rows. Decimal commas remain usable. Invalid numeric text must prevent saving rather than silently save another value. Display unsaved status and warn on browser unload while modified. Pending saves freeze editing. Do not claim server persistence from an unconfirmed action result.

## Review Focus

- Mixed units and negative quantities: monetary summary must remain meaningful.
- Existing steel measures: preserve repetition and historical partials.
- Filtering: hidden measurements must still be included in save and summary.
- Last-row deletion: preserve persisted empty entries and support undo.
- Invalid decimal input or failed save: keep user drafts visible and prevent misleading saved state.

### Task 1: Measurement workspace model

**Files:** Create `apps/web/src/lib/metre-workspace.ts` and `.test.ts`.

- [x] Write and run failing tests for mixed-unit monetary totals, cumulative overrun, accent-insensitive price search, incomplete measurements and signed deductions.
- [x] Implement typed pure summary/search/measurement-status helpers, reusing existing calculation functions.
- [x] Run targeted unit tests.

### Task 2: Workspace and assisted entry

**Files:** Modify `apps/web/src/app/(app)/projects/[id]/btp/MetreEditor.tsx` and its tests. Modify `apps/web/src/app/(app)/projects/[id]/metres/[periodeId]/page.tsx`.

- [x] Add summary, searchable article index, filters, expansion controls and meaningful empty results.
- [x] Redesign article quantities and period header/export presentation using existing theme tokens.
- [x] Improve cell visibility, labels, formula guidance, duplicate/delete undo and keyboard entry.
- [x] Guard invalid input, save pending edits and unsaved unload. Preserve action and payload contracts.
- [x] Run editor regression tests, including previous-period/steel/save contracts.

### Task 3: Verify and review

- [x] Run web tests and TypeScript checks.
- [x] Exercise the rendered page at desktop/mobile sizes and capture screenshots. Use isolated fixture data for destructive/save checks.
- [x] Request an independent TypeScript/code review and resolve actionable issues.
- [x] Report actual checks and any limits; leave changes reviewable in the current branch.

## Execution record

- Initial repository state clean, existing branch `codex/terrain-operations`.
- User opted out of clarification and authorized the proposed approach. Execute continuously in the current workspace; do not introduce a separate integration/approval step.

- Verification: 28 web test files / 164 tests passed; TypeScript passed; eight isolated Playwright journeys passed. Full source builds compiled successfully; final local image activation and live visual check recorded below.
- Independent reviews: fixed empty/overrun-filter unmounting, sticky index containment and undo persistence after first save. Reviewer independently reproduced both persistence/filter fixes and approved.
- Save/error browser checks use isolated fixture data; no real project measurements were modified.

- Final verification: production Docker build passed and web service recreated on localhost:13001. Live page contains all 18 prices and preserves price 1 quantity 73.98 m³. Search leaves monetary summary unchanged; four export links remain available. Desktop index and jump target settle at 96px below the sticky header. Mobile 390px has no page-level horizontal overflow. Light/dark/mobile screenshots saved under artifacts/metre-workspace-*.png. Both existing live historical-period Playwright journeys passed (P2 and P3).
