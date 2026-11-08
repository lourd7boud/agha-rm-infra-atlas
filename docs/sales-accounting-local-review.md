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
- Full Core suite after dependency remediation: 1,370 passing tests, 29 skipped
  (162 passing files, 7 skipped), including oversized collection validation.
- Core and Web TypeScript checks: passed.
- Final Web production build: passed. The earlier server-action object export
  failure was corrected before this build.
- Browser suite: 3 skipped because dedicated test credentials/tokens were absent.
  Skips are not release verification.
- PostgreSQL verification subsequently ran in a disposable pgvector:pg16
  container, separate from the running application database: all 29 previously
  skipped repository integration tests passed, plus 2 migration regressions
  and 1 real sales/accounting workflow test (32 passing integration tests).
- Fresh migration replay: all 66 migrations applied. Fixed 0065 colliding with
  the sequence table from 0051. Legacy counters are retained and mapped using
  their high-water marks; existing four-digit official references are preserved.
- Dependency audit after remediation: zero reported vulnerabilities, down from
  92 (6 critical, 43 high, 35 moderate, 8 low).
  See [dependency remediation](security-dependency-remediation.md) for versions,
  compatibility decisions, and audit scope.

## Outstanding work

Run the authenticated browser journeys against a designated local/staging dataset,
including issued print fields, partial settlement, credit notes/reversals,
blocked reconciliation retry, and actual direction/comptable/admin-si sessions.
The current browser suite covers the review destination and the admin approval
denial; the complete planned financial journeys are still pending.

The separate PostgreSQL workflow verifies balanced draft projection, partial
receipts, all-or-nothing rejected approval selection, and validation actor/time.
Complete the remaining sales-specific concurrent issuance/payment and
credit-note/refund browser scenarios before release.

Do not treat this branch as deployment-ready based solely on the unit checks.
No push, deployment, operational migration, Docker cleanup, or removal of another
dirty worktree is part of this verification.
