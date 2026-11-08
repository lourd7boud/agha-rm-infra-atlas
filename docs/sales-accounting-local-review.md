# Local sales/accounting release — 2026-11-08

Branch: `codex/sales-accounting-compliance`, pushed to origin.
Application source: `aa364d82ed502a723745fe86e6dc86ce3463f6e0`.
The user authorized updating their existing local Docker installation and testing
with compensating records. The remote VPS was not deployed.

## Delivered behavior

Drafts receive official six-digit numbers when issued. Issued documents retain
immutable seller/client legal snapshots and references. Settlement uses integer
centimes, append-only receipts/reversals, issued credits and bounded idempotent
refunds. Transactions serialize concurrent numbering and payments.

Accounting events produce balanced draft entries, expose blocked/retry states and
require explicit selected-entry approval by direction/comptable. Admin-si cannot
approve entries or configure TVA. The original `non_configure` TVA setting was
restored after testing; an accountant must choose the real taxable event/mappings.

Release review corrected draft-credit constraints, refunds, reversal TVA copying,
historical rounding, partial-credit final residuals, debits receipts, legacy paid
openings and business-date exercise selection. A real Nest container regression
guards production reconciliation dependency injection.

## Verification

- Final full workspace suite on the synchronized main checkout: Core 1,374,
  Web 158, signing bridge 10 and preview 3 passed. The production wiring correction
  also passed all 8 focused controller/Nest checks; workspace typechecks passed.
- Dedicated PostgreSQL verification: all 29 formerly skipped repository cases,
  2 fresh/legacy migration regressions and 5 sales/accounting workflows passed.
  Coverage includes concurrency, rejected overpayment, duplicate refunds,
  out-of-order reversal/recollection, final TVA centimes and a closed prior year.
- Real authenticated local browser journeys passed: direction's draft, issue,
  partial/full receipt, reversal, credit, refund and legal print; comptable's
  blocked state, TVA setup, UI retry and explicit audited approval; admin-si's
  read-only UI and HTTP 403 financial-command denials. Direction passed on the
  initial run; accounting/admin were rerun after the wiring correction on that
  same compensated invoice, avoiding another official test number.
- Dependency audit: zero known vulnerabilities, down from 92.
- Next.js production Docker build and TypeScript checks passed.
- Independent review found no remaining critical/important release findings.

## Operational migration and backup

Old Web/Core/Worker writers were stopped before migration. A fresh custom-format
dump was copied outside Docker; host/container SHA256 hashes matched:

`LOCAL_BACKUPS/before-sales-e1bcd95/atlas-before-sales.dump`

SHA256: `ec016299bead99e4e1a748383b53c758aa6ae0d8204de3ba7ac818ee5f367145`.

The restored legacy sequence table belonged to postgres; its ownership was
normalized to the existing schema/application owner atlas. Drizzle migration
0065 succeeded. The ledger has 66 rows, ending at `1793203207000`.
The original 65 projects and 109,800 tenders were preserved. Previous images
remain tagged `before-sales-e1bcd95`.
The fresh dump also passed a complete restore with `--exit-on-error` in a separate
PostgreSQL database: the same 65 projects, 109,800 tenders and 65 pre-release
migrations were recovered. Temporary database containers/volume, intermediate
images and the redundant older dump were removed afterwards. The verified fresh
dump remains outside Docker. Final Core/Worker/Web revision labels all match the
application source above; health and the normal account's project/tender browser
navigation passed after the final container recreation.
Unused Docker build cache cleanup reported 7.935 GB reclaimed inside Docker.
The main checkout was fast-forwarded to this reviewed branch and its dependencies
were synchronized with the frozen lockfile; both checkouts are clean.

The remaining uncommitted diffs in the four older Claude worktrees were inspected.
They are alternative NBSP/narrow-NBSP parsing corrections and fixture regressions;
equivalent runtime fixes and the money regression already exist in commit
`8f5ec39` and are included in this release. They do not represent unfinished new
features. Those older worktrees were preserved, without overwriting their edits.

Retained invoice `FAC-2026-000001` is clearly labelled TEST E2E. Its issued credit
and refund compensate it fully. All seven accounting entries were explicitly
validated; each account 3421, 4455, 4456, 5141 and 71242 has a 0.00 MAD net balance.
Temporary identity accounts were removed; audit actor names remain in history.

## Remaining operational configuration

The accountant must choose the real TVA taxable event and active account mappings.
Until then, commercial events remain available for reconciliation and are not
auto-approved.

The user subsequently confirmed Gemini is unavailable and has not been purchased.
The local configuration now sets `DEFAULT_LLM_ENABLED=false` to disable the stale
default extraction/enrichment/assistant route without substituting another paid
provider. Deterministic portal parsing remains available. Dedicated Claude chat,
expert and pricing configuration is preserved. No paid generation request was
used to test those accounts, and their provider availability is not newly asserted.

A pre-migration restore discards later writes. Once issued documents exist, use a
reviewed recovery/forward-fix procedure instead of blindly replacing the database
or starting old writers against the new schema.
