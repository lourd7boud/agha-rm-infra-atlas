# Terrain operations

## Daily workflow

Open **Journée du chantier**. Choose the date/default zone, confirm attendance,
record production and resources, then save or submit. Each production row can
have its own zone. Material receipts and consumption remain distinct. Temporary
people and unlinked BPU quantities stay visibly unresolved until office settlement.

Office review materializes the operational records atomically in existing tabs.
Retrying cannot duplicate them. Internal review is not client certification.
Blockers can be resolved after review. Safe, reasoned reopening retains previous
payload, source references and complete resource snapshots; integrated quantities,
cash expenses and submitted/locked decomptes require their official correction flow.

Attachments integrate into a selected open measurement period, save a real metre
link and rebuild the decompte chain. Linked source quantities cannot be silently
edited, removed or duplicated from measurement forms.
Legacy integrated flags without a metre link are shown as needing verification;
they cannot automatically append a second quantity to an existing measurement.

## Costs and production

The overview separates known resource valuations, standalone reconciled expenses
and unresolved expenses. Office expense classification is versioned and audited;
resource-linked expenses are not added a second time. Changed linked valuations
invalidate reconciliation. Reconciled expenses cannot be deleted.

The latest live decompte sequence is used consistently with the project header;
its document status is visible. Labour snapshots freeze the effective daily rate.
Unknown historical rates are never backfilled from current assignments.

Production displays reviewed daily declarations per BPU/unit/zone, with submitted
quantities separately. Legacy measurements entered only in Administratif are
explicitly outside this view. No global physical progress is inferred.

Final cost, profit and completion forecasts remain unavailable until completeness,
tax basis and planning assumptions support them. The expense resource picker
includes the project's full attendance history; all references remain scoped
to the project.

## Offline boundary

After the page loads, incomplete drafts are saved locally per account/project/day.
Stable UUIDs and expected versions prevent blind retries/overwrites. Conflicts,
storage failure and network state are visible, and a JSON export is available.
This is local recovery, not a service worker/PWA or offline image-upload queue.

## Verification and deployment

Additive Drizzle migrations: **0053–0057**. Apply with the standard
`pnpm --filter @atlas/core db:migrate` and the intended DATABASE_URL.

```powershell
pnpm --filter @atlas/core test -- btp-terrain btp-journee btp-attachement btp-engines
pnpm --filter @atlas/web test
pnpm --filter @atlas/core typecheck
pnpm --filter @atlas/web typecheck
```

PostgreSQL regressions are opt-in: `TERRAIN_TEST_DATABASE_URL` must name
`atlas_terrain_finance_test`; `TERRAIN_INTEGRATION_DATABASE_URL` must name
`atlas_terrain_integration_test` with the full schema/Terrain migrations;
`TERRAIN_JOURNEE_DB_TEST=1` targets local `atlas_terrain_journee_test`.
Fixtures are destructive only inside these explicitly guarded disposable DBs.

The opt-in browser test uses `TERRAIN_E2E_BASE_URL` and
`TERRAIN_E2E_PROJECT_ID`:
`pnpm --filter @atlas/web exec playwright test e2e/terrain-workspace.spec.ts`.
It logs in with the local development realm, checks desktop/mobile and restores
a local draft without submitting business data.

Local runtime images are tagged `terrain-20261027`; dependencies were compared
with installed images before an incremental source build and Linux Next.js build.
The ordinary Dockerfiles continue to build the checked-out sources. No remote
deployment was performed. Full core testing also exposes two existing failures
in portal caution parsing/crawling outside the Terrain changes.
