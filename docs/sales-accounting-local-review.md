# Local sales/accounting review — 2026-11-08

Working branch: `codex/sales-accounting-compliance`.
Implementation is saved separately from the running system; migration 0065
has not been applied to the operational database.

Completed local work includes issue-time numbering, exact-centime settlement,
immutable seller/client snapshots, event reconciliation into draft entries,
explicit accounting approval selection, audited TVA/account mapping configuration,
and removal of the old public manual invoice-status and annual approval paths.

## Evidence and limits

- Web unit suite: 158 passing tests.
- Sales repository/controller focused suite: 31 passing tests.
- Controller authorization/configuration suite: 7 passing tests.
- Sales/accounting orchestration regression: passing.
- Full Core suite: 1,369 passing tests, 29 skipped (161 passing files, 7 skipped).
- Core and Web TypeScript checks: passed.
- Final Web production build: passed. The earlier server-action object export
  failure was corrected before this build.
- Browser suite: 3 skipped because dedicated test credentials/tokens were absent.
  Skips are not release verification.
- Dependency audit: 92 findings (6 critical, 43 high, 35 moderate, 8 low).
  Includes the pinned Next.js version; package upgrades and regression checks
  remain necessary before release.

## Outstanding work

Run the authenticated browser journeys against a designated local/staging dataset,
including issued print fields, partial settlement, credit notes/reversals,
blocked reconciliation retry, and actual direction/comptable/admin-si sessions.
The current browser suite covers the review destination and the admin approval
denial; the complete planned financial journeys are still pending.

Review and resolve dependency audit findings. Complete database-backed concurrency,
rollback, sequence and validation auditing checks with a disposable PostgreSQL
database. The in-memory orchestration regression does not prove database isolation.

Do not treat this branch as deployment-ready based solely on the unit checks.
No push, deployment, operational migration, Docker cleanup, or removal of another
dirty worktree is part of this verification.
