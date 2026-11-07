# Sales & Accounting Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready Moroccan sales-to-accounting flow for clients, quotes, delivery notes, invoices, receipts, credit notes, legal printing, and controlled accounting validation without weakening the existing ATLAS security or document infrastructure.

**Architecture:** Keep the existing NestJS modular monolith, Drizzle/PostgreSQL schemas, Next.js App Router, and central role guards. Add a deterministic centime-based domain layer, transactional official numbering, an append-only payment ledger, immutable issued commercial documents, and a durable sales-accounting event/reconciliation table. Commercial operations commit independently; accounting projection is idempotent and either creates a balanced draft entry or records an explicit blocked reason for an accountant to resolve. Web pages call typed server actions and never derive authoritative balances locally.

**Tech Stack:** TypeScript 5.7, NestJS 11, Drizzle ORM/PostgreSQL, Zod, Vitest, Next.js 15 App Router, React 19, pnpm workspaces.

## Global Constraints

- Apply test-driven development: add one failing behavioral test, run it and observe the expected failure, implement the minimum production code, then rerun the focused test before widening the suite.
- Keep monetary calculations as integer centimes inside the domain. Convert PostgreSQL `numeric(14,2)` and HTTP decimal strings only at explicit boundaries.
- Do not copy the uncommitted prototype from the original workspace. It may be consulted only after the clean-worktree test defines the required behavior.
- Do not delete or rewrite legacy commercial references. New drafts have no official reference; a reference is allocated only when issued.
- Never mutate an issued invoice or credit note. Correct it with an issued credit note and/or append-only payment reversal.
- All generated accounting entries remain `brouillon`; only `direction` and `comptable` can validate entries or configure the TVA taxable-event regime.
- If TVA configuration, account mapping, or an open exercise is missing, the commercial operation succeeds and the reconciliation event is persisted as `blocked`. Never swallow the failure.
- Use migration `0053_sales_accounting_flow.sql`; retain all existing storage, document, and project-document infrastructure.
- Every schema/API change must remain backward-readable for rows created before this release.
- The implementation demonstrates technical alignment with the cited Moroccan sources; final tax/account mapping remains subject to confirmation by the company accountant.

---

## Task 1: Introduce exact money and settlement domain primitives

**Files:**

- Create: `apps/core/src/modules/sales/sales-money.domain.ts`
- Create: `apps/core/src/modules/sales/sales-money.domain.spec.ts`
- Create: `apps/core/src/modules/sales/sales-invoice.domain.ts`
- Create: `apps/core/src/modules/sales/sales-invoice.domain.spec.ts`

- [x] **Step 1: Write failing money tests**

Cover decimal-string-to-centime conversion, two-decimal rejection/rounding policy, addition without floating-point drift, pro-rata allocation, and residual centime assignment to the final allocation.

```ts
expect(parseMoneyCents('110.50')).toBe(11_050);
expect(formatMoneyCents(11_050)).toBe('110.50');
expect(allocateCentsProRata(10_001, [1, 1, 1])).toEqual([3_333, 3_333, 3_335]);
```

- [x] **Step 2: Run the focused test and observe RED**

Run: `pnpm --filter @atlas/core test -- sales-money.domain.spec.ts`

Expected: failure because the domain module does not exist.

- [x] **Step 3: Implement the money boundary**

Export the following exact interface:

```ts
export type MoneyCents = number;
export function parseMoneyCents(value: string | number): MoneyCents;
export function formatMoneyCents(value: MoneyCents): string;
export function allocateCentsProRata(total: MoneyCents, weights: readonly MoneyCents[]): MoneyCents[];
```

Reject non-finite, negative where the caller requires a positive value, and unsafe-integer results. Keep rounding policy explicit and deterministic.

- [x] **Step 4: Write failing invoice-state tests**

Cover:

- lifecycle `brouillon -> emise -> annulee`, with no reverse transition;
- settlement derivation for zero, partial, exact, overpayment/customer-credit, and full refund;
- available credit-note amount never exceeding the original issued invoice total;
- payment reversal restoring the previous balance;
- credit-note allocation consuming receivable before collected cash.

```ts
expect(deriveSettlement({ totalCents: 12_000, receivedCents: 5_000, creditedCents: 0, refundedCents: 0 }))
  .toMatchObject({ state: 'partiellement_payee', outstandingCents: 7_000 });
```

- [x] **Step 5: Run the invoice-state test and observe RED**

Run: `pnpm --filter @atlas/core test -- sales-invoice.domain.spec.ts`

- [x] **Step 6: Implement invoice lifecycle and settlement derivation**

Export discriminated unions `InvoiceLifecycle`, `InvoiceSettlementState`, `PaymentMovementType`, and pure functions `assertInvoiceTransition`, `deriveSettlement`, and `allocateCreditNote`. Domain errors must identify the violated invariant.

- [x] **Step 7: Run focused tests and commit**

Run:

```powershell
pnpm --filter @atlas/core test -- sales-money.domain.spec.ts sales-invoice.domain.spec.ts
pnpm --filter @atlas/core typecheck
git add apps/core/src/modules/sales
git commit -m "feat(sales): add exact money and settlement domain"
```

---

## Task 2: Define Moroccan TVA accounting postings as pure balanced transactions

**Files:**

- Create: `apps/core/src/modules/compta/compta-ventes.domain.ts`
- Create: `apps/core/src/modules/compta/compta-ventes.domain.spec.ts`
- Create: `apps/core/src/modules/compta/compta-reglements.domain.ts`
- Create: `apps/core/src/modules/compta/compta-reglements.domain.spec.ts`
- Modify: `apps/core/src/modules/compta/compta-livres.domain.ts`

- [x] **Step 1: Write failing invoice-posting tests**

Assert exact centimes and account directions:

- `encaissement`: debit `3421` TTC, credit revenue HT, credit `4455` pending TVA;
- `debits`: debit `3421` TTC, credit revenue HT, credit `4456` due TVA;
- every posting balances exactly;
- `non_configure` produces a typed blocking result instead of a posting.

- [x] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- compta-ventes.domain.spec.ts`

- [x] **Step 3: Implement issue and credit-note builders**

Use these contracts:

```ts
export type FaitGenerateurTva = 'non_configure' | 'encaissement' | 'debits';
export type PostingResult =
  | { kind: 'ready'; label: string; lines: PostingLine[] }
  | { kind: 'blocked'; code: PostingBlockCode; message: string };

export function buildInvoiceIssuePosting(input: InvoicePostingInput): PostingResult;
export function buildCreditNotePosting(input: CreditNotePostingInput): PostingResult;
```

For a credit note, reverse revenue and route TVA reversal between `4455` and `4456` from the unpaid/collected allocation passed by the sales domain.

- [x] **Step 4: Write failing receipt/refund tests**

Assert:

- receipt: debit configured treasury, credit `3421`;
- `encaissement` additionally debits `4455` and credits `4456` proportionally;
- the last receipt receives all residual TVA centimes;
- reversal/refund exactly negates the original movement and is separately traceable.

- [x] **Step 5: Run RED, implement, and verify balance**

Run: `pnpm --filter @atlas/core test -- compta-reglements.domain.spec.ts`

Implement `buildReceiptPosting`, `buildPaymentReversalPosting`, and `buildRefundPosting`. Reuse the existing accounting-entry balance validation rather than duplicating it.

- [x] **Step 6: Run focused tests and commit**

```powershell
pnpm --filter @atlas/core test -- compta-ventes.domain.spec.ts compta-reglements.domain.spec.ts compta.domain.spec.ts
pnpm --filter @atlas/core typecheck
git add apps/core/src/modules/compta
git commit -m "feat(compta): model TVA sales and receipt postings"
```

---

## Task 3: Add the additive sales-accounting database model and migration

**Files:**

- Modify: `apps/core/src/db/schema/sales.ts`
- Modify: `apps/core/src/db/schema/compta.ts`
- Create: `apps/core/drizzle/0053_sales_accounting_flow.sql`
- Modify: `apps/core/drizzle/meta/_journal.json`
- Create: `apps/core/src/db/sales-accounting-schema.spec.ts`

- [x] **Step 1: Write failing schema contract tests**

Import the Drizzle tables and assert the columns, unique indexes, and foreign-key surfaces required by the domain. The test must instantiate schema metadata, not grep SQL text.

- [x] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- sales-accounting-schema.spec.ts`

- [x] **Step 3: Extend `sales` schema additively**

Add:

- nullable `reference`, `issuedAt`, `issuedBy`, `legalSnapshot`, `paymentTerms`, and optimistic `version` to invoice/quote/delivery-note records as applicable;
- `clientType` with safe default `professionnel` while preserving existing rows;
- `sales.doc_sequence(company_id, doc_type, fiscal_year, last_value)` with one unique row per scope;
- `sales.invoice_payment` with immutable movement type `encaissement | remboursement`, original movement link for reversal, amount, method, treasury account, value date, actor, and timestamps;
- `sales.credit_note` and `sales.credit_note_line`, each draft-first and officially numbered on issue;
- `sales.accounting_event` with unique event identity, payload snapshot, `pending | projected | blocked`, attempts, last error code/message, and linked accounting entry.

- [x] **Step 4: Extend `compta` schema additively**

Add `faitGenerateurTva` to `compta.profil` with database default `non_configure`. Add `sourceEvent`, `validatedBy`, and `validatedAt` to entries. Replace the active-source uniqueness constraint with `(source, source_id, source_event)` so invoice issue, each receipt, reversal, and credit note are independently idempotent.

- [x] **Step 5: Write migration `0053` with data preflight**

The SQL must:

1. abort if existing non-null references conflict inside the intended company/type/year scope;
2. preserve every existing reference and assign legacy documents an issued snapshot only when their current status proves they were issued;
3. add constraints and indexes after backfill;
4. never drop upload/storage/document tables;
5. replace only the old accounting-source unique index;
6. use a timestamp greater than `1784510000000` in the journal.

- [x] **Step 6: Verify migration generation does not produce an unexpected diff**

Run `pnpm --filter @atlas/core db:generate` in a temporary inspection branch or inspect generated output without accepting unrelated drift. If Drizzle generates a snapshot, keep only artifacts consistent with `0053`; never renumber deployed migrations.

Audit note (2026-11-07): isolated generation cannot provide a meaningful
incremental diff because the repository intentionally uses custom migrations
without a snapshot for every migration number. No generated artifact was
accepted. The Drizzle metadata contract test, migration preflight SQL, journal
ordering, focused tests, and Core typecheck are the authoritative checks.

- [x] **Step 7: Run tests/typecheck and commit**

```powershell
pnpm --filter @atlas/core test -- sales-accounting-schema.spec.ts
pnpm --filter @atlas/core typecheck
git diff --check
git add apps/core/src/db apps/core/drizzle
git commit -m "feat(db): add sales accounting flow schema"
```

---

## Task 4: Make official numbering and issued-document immutability transactional

**Files:**

- Modify: `apps/core/src/modules/sales/sales.types.ts`
- Modify: `apps/core/src/modules/sales/sales.repository.ts`
- Modify: `apps/core/src/modules/sales/sales.repository.spec.ts`
- Modify: `apps/core/src/modules/sales/sales.drizzle.repository.ts`
- Create: `apps/core/src/modules/sales/sales.drizzle.repository.spec.ts`

- [ ] **Step 1: Change repository tests first**

Update creation tests so drafts do not accept/allocate a reference. Add failing tests for `DEV-YYYY-NNNNNN`, `BL-YYYY-NNNNNN`, `FAC-YYYY-NNNNNN`, and `AV-YYYY-NNNNNN`; issuing twice returns the same result; concurrent sequence allocation cannot duplicate; issued documents reject edits/deletion.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- sales.repository.spec.ts sales.drizzle.repository.spec.ts`

- [ ] **Step 3: Define repository contracts**

Add precise commands/results:

```ts
issueQuote(id: string, actor: string, issuedAt: Date): Promise<QuoteRecord>;
issueDeliveryNote(id: string, actor: string, issuedAt: Date): Promise<DeliveryNoteRecord>;
issueInvoice(id: string, actor: string, issuedAt: Date, legalSnapshot: LegalSellerSnapshot): Promise<InvoiceRecord>;
updateDraftInvoice(id: string, input: UpdateInvoiceDraft): Promise<InvoiceRecord>;
deleteDraftInvoice(id: string): Promise<void>;
recordPayment(input: RecordInvoicePayment): Promise<InvoiceAggregate>;
reversePayment(input: ReverseInvoicePayment): Promise<InvoiceAggregate>;
createCreditNote(input: CreateCreditNote): Promise<CreditNoteRecord>;
issueCreditNote(id: string, actor: string, issuedAt: Date): Promise<CreditNoteRecord>;
```

Return an `InvoiceAggregate` containing authoritative totals, payments, credit notes, settlement, and accounting-event status. Preserve the migration's explicit `legacyPaid` opening position: when no payment movements exist it yields a paid settlement with visible legacy provenance; never invent a treasury account or payment method.

- [ ] **Step 4: Implement in-memory behavior**

Use the in-memory repository as the fast contract implementation. Append an accounting event in the same logical operation as invoice issue, payment/reversal, or credit-note issue.

- [ ] **Step 5: Implement Drizzle transactions**

Use `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` for the scoped counter inside the same transaction that issues the document. Lock/update the invoice aggregate for payments and credit notes. Insert a unique accounting event in that transaction. Translate unique conflicts to stable domain/API errors.

- [ ] **Step 6: Run focused tests and commit**

```powershell
pnpm --filter @atlas/core test -- sales.repository.spec.ts sales.drizzle.repository.spec.ts
pnpm --filter @atlas/core typecheck
git add apps/core/src/modules/sales
git commit -m "feat(sales): enforce transactional issue lifecycle"
```

---

## Task 5: Project commercial events into draft accounting entries with reconciliation

**Files:**

- Create: `apps/core/src/modules/compta/compta-auto-posting.service.ts`
- Create: `apps/core/src/modules/compta/compta-auto-posting.service.spec.ts`
- Modify: `apps/core/src/modules/compta/compta.repository.ts`
- Modify: `apps/core/src/modules/compta/compta-repository.module.ts`
- Modify: `apps/core/src/modules/compta/compta.module.ts`
- Modify: `apps/core/src/modules/sales/sales.module.ts`

- [ ] **Step 1: Write failing service tests**

Use repository fakes to cover:

- one event creates one balanced draft entry and marks the event `projected`;
- replay returns the existing entry without duplication;
- `non_configure`, missing account, and closed exercise mark the event `blocked` with a stable code;
- a transient database failure increments attempts and remains retryable;
- successful retry clears the old blocking message;
- commercial issue/payment result remains committed even when projection blocks.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- compta-auto-posting.service.spec.ts`

- [ ] **Step 3: Implement the idempotent projector**

`ComptaAutoPostingService.projectEvent(eventId)` loads the immutable event payload and current accounting configuration, calls the pure posting builder, inserts the entry and lines transactionally, and updates reconciliation status. It must not validate the entry.

- [ ] **Step 4: Replace blind annual generation with reconciliation**

Retire `genererEcrituresVentes(year, actor)` from public use. Add:

```ts
reconcileSalesEvents(input: { ids?: string[]; year?: number; actor: string }): Promise<ReconciliationSummary>;
listSalesReconciliation(filters: ReconciliationFilters): Promise<ReconciliationRecord[]>;
```

Processing without explicit IDs is allowed only for `pending`/`blocked` events in the requested year and remains idempotent.

- [ ] **Step 5: Wire modules without a circular dependency**

Keep sales event persistence in `SalesRepository`. Export the required event-store port from `SalesModule`; import it into the compta repository/service layer. If Nest module construction would form a cycle, move the narrow event-store provider into a new `SalesAccountingEventModule` that both modules import; do not use `forwardRef` as the default fix.

- [ ] **Step 6: Run tests and commit**

```powershell
pnpm --filter @atlas/core test -- compta-auto-posting.service.spec.ts compta.domain.spec.ts
pnpm --filter @atlas/core typecheck
git add apps/core/src/modules/compta apps/core/src/modules/sales
git commit -m "feat(compta): reconcile sales events into draft entries"
```

---

## Task 6: Expose guarded sales and accounting APIs

**Files:**

- Create: `apps/core/src/modules/sales/sales.controller.spec.ts`
- Create: `apps/core/src/modules/compta/compta.controller.spec.ts`
- Modify: `apps/core/src/modules/sales/sales.module.ts`
- Modify: `apps/core/src/modules/compta/compta.module.ts`
- Modify: `apps/core/src/modules/compta/compta-http.helpers.ts`

- [ ] **Step 1: Write failing controller and metadata tests**

Cover request validation and response shapes for:

- `POST /sales/quotes/:id/issue`
- `POST /sales/delivery-notes/:id/issue`
- `POST /sales/invoices/:id/issue`
- `POST /sales/invoices/:id/payments`
- `POST /sales/invoices/:id/payments/:paymentId/reverse`
- `POST /sales/invoices/:id/credit-notes`
- `POST /sales/credit-notes/:id/issue`
- `GET /compta/reconciliation/ventes`
- `POST /compta/reconciliation/ventes/retry`
- `POST /compta/ecritures/valider-selection`

Assert that `comptable` and `direction` are the only roles on TVA taxable-event updates and entry validation. Assert that `admin-si` cannot gain financial approval merely from the class-level accounting role.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- sales.controller.spec.ts compta.controller.spec.ts`

- [ ] **Step 3: Implement sales DTO schemas and endpoints**

Do not accept a user-entered official reference. Require a professional client's ICE before invoice issue, a configured seller legal snapshot, strictly positive payment/credit amounts, ISO dates, supported methods, and optimistic version when editing a draft.

- [ ] **Step 4: Implement accounting endpoints and audit actors**

Read actor identity through `actorFrom(request)`. Validation writes `validatedBy` and `validatedAt`. Selected validation is all-or-nothing for eligible draft entries; return per-ID conflict information only when the whole command is rejected before mutation.

- [ ] **Step 5: Run focused and full core tests, then commit**

```powershell
pnpm --filter @atlas/core test -- sales.controller.spec.ts compta.controller.spec.ts
pnpm --filter @atlas/core test
pnpm --filter @atlas/core typecheck
git add apps/core/src/modules
git commit -m "feat(api): expose compliant sales accounting workflow"
```

---

## Task 7: Update typed web clients and server actions

**Files:**

- Modify: `apps/web/src/lib/sales.ts`
- Modify: `apps/web/src/lib/compta.ts`
- Create: `apps/web/src/lib/sales-accounting.test.ts`
- Create: `apps/web/src/app/(app)/sales/invoices/actions.ts`
- Modify: `apps/web/src/app/(app)/compta/actions.ts`

- [ ] **Step 1: Write failing web contract tests**

Test parsing/formatting of the new API aggregates and ensure frontend status labels are exhaustive for all lifecycle, settlement, payment, credit-note, and reconciliation states.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/web test -- sales-accounting.test.ts`

- [ ] **Step 3: Update types from the API contract**

Remove mandatory draft `reference`. Add `issuedAt`, lifecycle, settlement summary, payment movements, credit notes, legal snapshot, and projection status. Keep conversions at the API boundary; React components receive formatted strings and exact centime fields.

- [ ] **Step 4: Implement centralized server actions**

Add issue, update/delete draft, payment, reversal, credit-note create/issue, reconciliation retry, profile configuration, and selected-entry validation actions. Every successful mutation calls `revalidatePath` for the affected invoice list/detail/print and accounting pages. Convert known API errors into stable form-state messages; let unexpected errors reach the route error boundary.

- [ ] **Step 5: Run tests/typecheck and commit**

```powershell
pnpm --filter @atlas/web test -- sales-accounting.test.ts
pnpm --filter @atlas/web typecheck
git add apps/web/src/lib apps/web/src/app/'(app)'/sales/invoices/actions.ts apps/web/src/app/'(app)'/compta/actions.ts
git commit -m "feat(web): add typed sales accounting actions"
```

---

## Task 8: Replace manual invoice status changes with the real operational workflow

**Files:**

- Modify: `apps/web/src/app/(app)/sales/invoices/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/invoices/[id]/page.tsx`
- Create: `apps/web/src/app/(app)/sales/invoices/[id]/InvoiceWorkflow.tsx`
- Modify: `apps/web/src/app/(app)/sales/quotes/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/quotes/[id]/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/delivery-notes/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/delivery-notes/[id]/page.tsx`
- Create: `apps/web/src/app/(app)/sales/invoices/[id]/InvoiceWorkflow.test.tsx`

- [ ] **Step 1: Write failing workflow component tests**

Cover draft editing/issue, missing-legal-data blocking message, partial payment, payment reversal, credit-note creation/issue, authoritative balance display, and disabled mutation controls once issued. Verify keyboard labels and form error announcements.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/web test -- InvoiceWorkflow.test.tsx`

- [ ] **Step 3: Remove manual official references from create forms**

Show “Référence attribuée à l’émission” for drafts. Preserve existing reference display for legacy/issued rows. Replace direct `envoyee/payee/annulee` buttons with issue, receipt, reversal, and credit-note operations.

- [ ] **Step 4: Implement the invoice aggregate UI**

Display lifecycle separately from settlement. Show total, received, credited, refunded, outstanding/customer-credit, movements, credit notes, accounting projection badge, and the latest actionable blocked reason. Keep the existing ATLAS dark visual system.

- [ ] **Step 5: Apply issue semantics to quote and delivery note**

Draft quote/BL remains editable without a reference; issuing allocates DEV/BL reference and makes the official snapshot immutable. Do not alter project-specific document modules.

- [ ] **Step 6: Run tests/typecheck and commit**

```powershell
pnpm --filter @atlas/web test -- InvoiceWorkflow.test.tsx
pnpm --filter @atlas/web typecheck
git add apps/web/src/app/'(app)'/sales
git commit -m "feat(web): deliver issued sales document workflow"
```

---

## Task 9: Produce legally complete invoice output from immutable snapshots

**Files:**

- Modify: `apps/web/src/app/(app)/sales/invoices/[id]/print/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/quotes/[id]/print/page.tsx`
- Modify: `apps/web/src/app/(app)/sales/delivery-notes/[id]/print/page.tsx`
- Create: `apps/web/src/lib/legal-document.test.ts`
- Create: `apps/web/src/lib/legal-document.ts`

- [ ] **Step 1: Write failing legal-document model tests**

For an issued invoice, require seller raison sociale, address, ICE, IF, RC, taxe professionnelle when configured, client identity/address, professional client ICE, official number/date, line description/quantity/unit price, HT/TVA/TTC totals, payment terms, and currency. A draft returns a `BROUILLON — NON VALABLE` watermark. Missing required fields returns issue-block reasons.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/web test -- legal-document.test.ts`

- [ ] **Step 3: Implement a pure print view-model**

Build printable data from the invoice's immutable `legalSnapshot`, not live seller profile data, so later profile changes cannot rewrite history. Existing legacy rows may use a clearly marked compatibility fallback.

- [ ] **Step 4: Update print pages**

Use the shared view-model, current colors/fonts, print-safe CSS, and no hard-coded seller identity. Quote and delivery-note printouts reuse relevant seller/client sections without claiming invoice-only tax semantics.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm --filter @atlas/web test -- legal-document.test.ts
pnpm --filter @atlas/web typecheck
git add apps/web/src/app/'(app)'/sales apps/web/src/lib/legal-document*
git commit -m "feat(web): print immutable legal sales documents"
```

---

## Task 10: Add TVA configuration and explicit accounting validation queue

**Files:**

- Modify: `apps/web/src/app/(app)/compta/parametres/page.tsx`
- Modify: `apps/web/src/app/(app)/compta/ecritures/page.tsx`
- Create: `apps/web/src/app/(app)/compta/a-valider/page.tsx`
- Create: `apps/web/src/app/(app)/compta/a-valider/ValidationQueue.tsx`
- Create: `apps/web/src/app/(app)/compta/a-valider/ValidationQueue.test.tsx`
- Modify: `apps/web/src/components/nav/RailNav.tsx`
- Modify: `apps/web/src/lib/navigation-config.test.ts`

- [ ] **Step 1: Write failing navigation and queue tests**

Assert one `/compta/a-valider` navigation item, explicit checkbox selection, no “select all invisible pages” behavior, confirmation summary, partial-page selection preservation, and accessible error/status announcements.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/web test -- navigation-config.test.ts ValidationQueue.test.tsx`

- [ ] **Step 3: Add TVA taxable-event configuration**

Add `non_configure`, `encaissement`, and `debits` separately from filing frequency `mensuel | trimestriel`. Show a persistent warning while unconfigured. Render the control read-only for users outside `direction`/`comptable`; the API remains authoritative.

- [ ] **Step 4: Build `/compta/a-valider`**

List only draft entries with source, date, label, debit/credit total, projection warning, and explicit selected IDs. Validate through the selected-ID action and show the actor/date after refresh. Include blocked reconciliation events with a retry action but never auto-validate their resulting entries.

- [ ] **Step 5: Remove the blind annual generation action**

Replace “Générer depuis les ventes” with a link to reconciliation/validation status. Retain manual entry CRUD. Do not expose the retired bulk generator through another shortcut.

- [ ] **Step 6: Run tests/typecheck and commit**

```powershell
pnpm --filter @atlas/web test -- navigation-config.test.ts ValidationQueue.test.tsx
pnpm --filter @atlas/web typecheck
git add apps/web/src/app/'(app)'/compta apps/web/src/components/nav/RailNav.tsx apps/web/src/lib/navigation-config.test.ts
git commit -m "feat(compta): add controlled validation queue"
```

---

## Task 11: Add cross-layer regression and authorization coverage

**Files:**

- Create: `apps/core/src/modules/sales/sales-accounting-flow.spec.ts`
- Create: `apps/web/e2e/sales-accounting.spec.ts`
- Modify: `apps/web/playwright.config.ts` only if an existing project needs a stable authenticated fixture
- Modify: `platform/runbooks/staging-deploy.md`

- [ ] **Step 1: Write a core orchestration regression test**

Exercise: professional client -> draft invoice -> issue -> blocked accounting when TVA unconfigured -> configure `encaissement` -> reconcile -> partial receipt -> second receipt with residual centime -> credit note -> refund/reversal -> balanced draft entries -> selected validation by `comptable`. Assert immutable references and audit actors throughout.

- [ ] **Step 2: Run RED, then implement only missing orchestration seams**

Run: `pnpm --filter @atlas/core test -- sales-accounting-flow.spec.ts`

- [ ] **Step 3: Add E2E journeys**

Cover direction and comptable workflows, plus a denied `admin-si` financial approval. Verify draft watermark, official reference allocation, partial settlement badges, reconciliation blocked/retry states, `/compta/a-valider`, and print legal fields.

- [ ] **Step 4: Extend staging runbook**

Document preflight queries, backup, migration ledger verification, migration application, smoke commands, accounting-role checks, rollback boundaries, and the manual accountant sign-off for TVA regime/account maps. State that issued documents created after migration must not be rolled back destructively.

- [ ] **Step 5: Run the widest local verification and commit**

```powershell
pnpm test
pnpm typecheck
pnpm --filter @atlas/web build
pnpm --filter @atlas/web test:e2e -- sales-accounting.spec.ts
git diff --check
git add apps/core/src/modules/sales apps/web/e2e platform/runbooks/staging-deploy.md apps/web/playwright.config.ts
git commit -m "test: cover sales accounting compliance flow"
```

---

## Task 12: Review, production preflight, push, migrate, and deploy

**Files:**

- Modify only files required by review findings.
- Do not modify the original dirty workspace.

- [ ] **Step 1: Perform code, TypeScript, security, and migration reviews**

Review for integer-money violations, transaction boundaries, idempotency, sequence races, authorization metadata, mass-assignment, XSS in legal fields, auditability, and accidental document/storage deletion. Resolve every Critical/Important finding with a focused regression test.

- [ ] **Step 2: Run clean final verification**

```powershell
pnpm test
pnpm typecheck
pnpm --filter @atlas/web build
pnpm audit --audit-level high
git diff --check
git status --short
```

The build and tests must run without concurrent processes writing `.next`.

- [ ] **Step 3: Inspect production read-only and back up**

Confirm current commit, service health, migration ledger, existing sales row counts, reference conflicts, accounting profile, open exercise, account mappings, and the exact deployment script. Create and verify a timestamped PostgreSQL backup before migration. Abort on unexpected schema/data drift.

- [ ] **Step 4: Commit review fixes and push**

```powershell
git add apps/core apps/web platform docs
git commit -m "fix: harden sales accounting release"
git push -u origin codex/sales-accounting-compliance
```

- [ ] **Step 5: Deploy through the repository-supported production path**

Because `0053` replaces draft-reference and invoice-status invariants, first put
sales/accounting writes into a verified maintenance drain and stop the old Core
writer before applying the migration. Apply `0053` once, verify its migration
ledger row, start the exact reviewed Core/Web/Worker images, pass health checks,
then reopen writes. The deploy script must fail closed and keep maintenance mode
active if migration or health verification fails. Do not leave the legacy Core
serving between migration commit and new-container readiness, and do not use
ad-hoc edits on the server.

- [ ] **Step 6: Run post-deploy smoke tests**

Verify public health, authenticated navigation, client and draft creation, issue blocking when legal/TVA configuration is incomplete, sequence allocation, partial payment, blocked/projected reconciliation, validation authorization, print fields, no console errors, and service logs. Use a designated non-production financial test record or roll forward with an explicit compensating record; never delete an issued test invoice.

- [ ] **Step 7: Deliver the final report**

Report modified/deleted files, migration ID, official numbering strategy, payment/credit-note behavior, TVA/accounting projection logic, permissions, legal-output behavior, tests/build/audit results, pushed commit, deployed commit, backup identifier, migration verification, health/smoke results, and any residual accountant/legal sign-off item.

---

## Plan Self-Review Checklist

- [x] Every mutation has a corresponding failing test before implementation.
- [x] No task asks for a manual official reference on a new draft.
- [x] Document lifecycle and settlement state are never conflated.
- [x] Accounting failures are explicit reconciliation records and do not roll back the commercial event.
- [x] Every generated entry is draft and idempotent per event.
- [x] Only `direction`/`comptable` can configure taxable event or validate entries.
- [x] Migration number/timestamp are later than deployed `0052`/`1784510000000`.
- [x] Existing references and shared document infrastructure are preserved.
- [x] Legal print uses immutable issue-time snapshots.
- [x] No placeholder, incomplete marker, or ambiguous file ownership remains in this plan.
