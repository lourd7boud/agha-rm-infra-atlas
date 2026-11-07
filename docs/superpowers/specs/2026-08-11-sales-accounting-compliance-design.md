# ATLAS OS Sales and Accounting Compliance Design

**Date:** 2026-08-11
**Status:** Approved for implementation
**Scope:** Sales documents, customer settlements, automatic accounting drafts,
Moroccan invoice requirements, and supervisor validation workflow

## Objective

Complete the existing Sales and Comptabilite packages without redesigning ATLAS
OS or replacing its current domain boundaries. The result must provide reliable
commercial-document numbering, partial settlement tracking, accounting draft
generation, TVA treatment that reflects the company's configured tax event, and
an auditable approval workflow.

The existing UI identity, authentication, role model, project-level documents,
file storage, and unrelated Finance module remain unchanged.

## Legal and Professional Alignment

This design implements technical controls derived from the following official
Moroccan sources:

- Direction Generale des Impots, Code General des Impots 2026, especially
  article 95 (TVA taxable event) and article 145 (accounting and invoice
  requirements):
  https://www.finances.gov.ma/Publication/dgi/2025/CGI-2026-FR.pdf
- Ministry of Justice, Code de commerce, including article 19 and its reference
  to the accounting obligations established by law 9-88:
  https://adala.justice.gov.ma/api/uploads/2024/03/01/Code%20de%20commerce_compressed-1709282723074.pdf
- Ministry of Economy and Finance, Conseil National de la Comptabilite standards:
  https://www.finances.gov.ma/fr/Nos-metiers/Pages/cnc-normes.aspx

The software will enforce numbering, traceability, required invoice data,
immutability after issue, explicit tax configuration, and human validation. It
does not constitute a legal or tax certification. Before activating automatic
TVA posting in production, AGHA RM INFRA's authorized accountant must confirm
the actual TVA taxable-event option and the configured chart-of-account mappings.

## Existing Architecture and Problems

- `apps/core` is a NestJS application using Drizzle and PostgreSQL schemas split
  by domain (`sales`, `compta`, `finance`, and others).
- `apps/web` is a Next.js App Router application. Sales and accounting pages use
  server actions and the existing Core APIs.
- Sales invoices currently model a full-payment state through `paidAt`; they do
  not provide a settlement ledger or partial payments.
- Document references are assigned too early, at draft creation, which can leave
  legal numbering gaps when drafts are abandoned.
- Current automatic-posting work assumes a customer name is enough to mark an
  entry as certain. That is not a safe accounting-validation rule.
- `compta.profil.regimeTva` represents filing frequency
  (`mensuel | trimestriel`), not the TVA taxable event. Reusing it for
  encaissement/debits would conflate two separate tax concepts.
- The local unfinished migration was numbered `0051`, while production has
  already applied migrations through `0052`. Shipping it under the old number
  would cause Drizzle to skip it.
- Production inspection on 2026-08-11 found no rows in the Sales commercial
  document tables, but the migration must still fail safely if data appears
  before deployment.

## Chosen Architecture

Use a cohesive Sales-to-Accounting workflow while keeping repositories and APIs
inside their existing modules:

```text
Sales command
  -> transactional Sales repository
  -> immutable commercial event
  -> accounting posting service
  -> balanced Comptabilite entry in brouillon
  -> /compta/a-valider review
  -> authorized human validation
```

Business operations and accounting projection are separated. A commercial
event remains successful when accounting cannot be projected because TVA is not
configured or an exercise is closed; the mismatch is persisted as an explicit
reconciliation item and never hidden in a swallowed exception.

## TVA Configuration

Add `compta.profil.faitGenerateurTva` with these values:

- `non_configure`: safe default; no tax-bearing automatic entry may be created.
- `encaissement`: TVA becomes due proportionally when customer money is received.
- `debits`: TVA becomes due when the invoice or credit note is issued.

`regimeTva` remains the filing periodicity and is not renamed or repurposed.

Only `comptable` and `direction` may change `faitGenerateurTva`. Every change
records the old value, new value, actor, and timestamp. Changing the setting does
not rewrite validated accounting entries. Reconciliation offers an explicit,
reviewable backfill for unposted commercial events.

## Commercial Document Lifecycle and Numbering

### Drafts

- Draft invoices are editable and deletable.
- Drafts have an internal UUID but no official legal number.
- Draft printouts carry a prominent `BROUILLON` marker and cannot be represented
  as official invoices.
- The same issue-time numbering principle applies to quotes, delivery notes, and
  credit notes at their respective validation/issue transition.

### Issue

Issuing a document is one database transaction that:

1. locks the sequence row for `(documentType, fiscalYear)`;
2. validates all legally required seller, customer, date, line, tax, and payment
   information;
3. allocates the next number;
4. stores `issuedAt`, `issuedBy`, and an immutable content snapshot/hash;
5. changes the lifecycle state;
6. records an outbox/reconciliation event for accounting projection.

Sequences use distinct prefixes and counters for at least:

- `DEV` — devis;
- `BL` — bons de livraison;
- `FAC` — factures;
- `AV` — avoirs.

Uniqueness is enforced in PostgreSQL, not only in application code. A failed
transaction does not consume a number. Parallel issue requests serialize on the
sequence row and cannot produce duplicates. An idempotency key prevents a client
retry from issuing the same document twice.

### Issued Documents

- Issued documents cannot be edited or deleted.
- A correction uses a linked credit note; an official number is never reused.
- The server derives status transitions. The UI cannot directly set an invoice
  to `payee`.
- Existing official references, if any appear before migration, are preserved.
  A deployment preflight must abort on ambiguous or conflicting legacy numbers
  rather than silently renumber them.
- A legacy `payee` invoice is accepted only when `paid_at` is present. Migration
  marks it `legacy_paid` before normalizing the lifecycle to `emise`; settlement
  remains fully paid through that explicit compatibility marker until an
  accountant reconciles it into the append-only payment ledger.

## Legally Relevant Invoice Data

Issuing an invoice requires and snapshots:

- seller legal name, address, ICE, IF, professional-tax identifier, and the other
  company identifiers configured in `compta.profil`;
- operation/invoice date and continuous official invoice number;
- customer name and address;
- customer type (`professionnel | particulier`);
- customer ICE when the customer is a professional;
- line nature/designation, quantity, unit price, discount where applicable,
  tax rate or exemption basis, HT, TVA, and TTC totals;
- payment terms and planned payment method;
- actual payment method and reference on each recorded settlement;
- links to the originating quote or delivery note when present.

The official print route refuses issuance/official rendering with HTTP 422 when
required legal data is missing. It must use the company legal profile instead of
hard-coded seller text. Reprints render the immutable issue snapshot plus current
settlement history and are identified as copies, not newly issued documents.

## Settlement Ledger

Create a dedicated `sales.invoice_payment` ledger rather than reusing the generic
project-oriented `finance.payment` table.

Each record stores:

- invoice ID;
- movement type (`encaissement | remboursement`);
- positive amount in MAD;
- value date and recorded timestamp;
- method (`virement`, `cheque`, `especes`, `carte`, or another configured method);
- external/bank reference where applicable;
- optional linked credit-note ID for refunds;
- idempotency key;
- creator identity and audit metadata.

Payments and refunds are append-only. A mistake is corrected by a linked reversal
movement, not by editing or deleting history. The transaction locks the invoice,
prevents overpayment or over-refund, and rejects duplicate references within the
configured uniqueness scope.

Document lifecycle and settlement state are derived separately so a fully
credited paid invoice does not hide an outstanding customer refund:

- document lifecycle: `brouillon | emise | annulee`;
- settlement state: `non_reglee | partiellement_payee | payee |
  solde_crediteur | remboursee`.

`annulee` means issued credit notes fully neutralize the commercial document.
`solde_crediteur` takes precedence in the settlement display while a customer
refund remains payable; after the refund is recorded it becomes `remboursee`.

Money is calculated in integer centimes at domain boundaries. Display-layer
floating-point values are not used to decide balances or legal state.
The aggregate treats `legacy_paid` as a paid opening position only when no
post-migration settlement movements exist, and exposes that provenance in its
audit/compatibility data instead of fabricating a treasury account or payment
method.

## Credit Notes and Refunds

A credit note is a first-class immutable commercial document linked to exactly
one issued invoice. Its line quantities/amounts cannot cumulatively exceed the
remaining creditable quantities/amounts of that invoice.

At issue time, the credit is allocated deterministically:

- first against the invoice's outstanding receivable;
- any excess against previously collected amounts, creating a customer credit
  balance that must be settled by a recorded `remboursement` movement.

This permits correct handling of unpaid, partially paid, and fully paid invoices
without inventing an automatic bank movement. A full credit note cancels the
commercial invoice only when its total creditable amount is neutralized. The
refund action remains explicit and auditable.

## Accounting Projection

All generated entries are balanced and created as `brouillon`. No heuristic may
mark them validated or certain. Validation belongs to an authorized human.

### Invoice Issue — TVA on Encaissement

- Debit customer receivable: TTC.
- Credit sales/revenue accounts: HT, grouped by configured line account.
- Credit invoiced/not-yet-due TVA (`4455` mapping): TVA.

### Invoice Issue — TVA on Debits

- Debit customer receivable: TTC.
- Credit sales/revenue accounts: HT.
- Credit TVA due (`4456` mapping): TVA.

### Customer Receipt

For both regimes:

- Debit the selected treasury/cash account.
- Credit customer receivable.

For `encaissement`, also transfer the receipt's proportional TVA share:

- Debit invoiced/not-yet-due TVA (`4455`).
- Credit TVA due (`4456`).

Each intermediate receipt uses centime-safe proportional allocation. The final
receipt takes the remaining TVA residual so cumulative rounding equals the exact
invoice TVA, neither one centime more nor less.

### Credit Note

- Reverse revenue for the credited HT amount.
- Reverse TVA from `4456` under `debits`.
- Under `encaissement`, reverse `4455` for the allocation against unpaid value and
  `4456` for the allocation against collected value.
- Credit the customer balance for the TTC amount. If this creates a creditor
  balance, it remains until a refund movement debits the customer balance and
  credits the chosen treasury account.

Exact account IDs are configuration-driven and validated against the existing
Moroccan chart of accounts. Missing mappings block accounting projection and
create a reconciliation item; they do not create guessed postings.

### `non_configure`

Commercial issue and settlement records remain allowed so the business operation
is not lost. No tax-bearing accounting entry is generated. The system creates a
visible blocking reconciliation item that states `fait generateur TVA non
configure`. After an authorized user configures TVA, a deterministic backfill can
project missing drafts idempotently.

## Idempotency, Transactions, and Reconciliation

- Commercial writes use database transactions and row locks.
- Accounting entries have a unique `(sourceType, sourceId, eventType)` identity.
- Retrying a request returns the prior result or a conflict; it never duplicates
  a number, settlement, or journal entry.
- A persisted outbox/reconciliation record bridges Sales and Comptabilite so a
  process failure cannot leave an invisible partial operation.
- The reconciler reports missing, blocked, and already-projected events and may
  retry only missing/blocked events.
- A validated accounting entry is never overwritten by a retry or regime change.

## Supervisor Workflow: `/compta/a-valider`

Add a server-backed page using the current ATLAS design system. It shows:

- accounting drafts generated from invoice issue, receipt, credit note, and
  refund events;
- source document, amounts, reason, TVA regime, creation actor/date, and blocking
  reason where present;
- reconciliation items with direct links to the source;
- individual validation and selective checkbox validation by entry IDs.

The existing blind "validate all drafts for a year" action is not exposed for
this workflow. Bulk validation accepts explicit IDs, rechecks authorization and
entry state server-side, and records validator identity and timestamp per entry.

## Permissions

- Existing Sales and Comptabilite role assignments remain the source of truth.
- Current authorized financial roles may create drafts, issue documents, and
  record settlements according to existing policy.
- Only `comptable` and `direction` may configure the TVA taxable event or validate
  accounting entries.
- `admin-si` does not gain financial approval solely from technical-admin status.
- Core guards enforce every mutation; hiding a UI action is not authorization.
- `/compta/a-valider` and its APIs apply the same server-side roles.

## API and Error Semantics

- `409 Conflict`: duplicate idempotency/reference, concurrent invalid transition,
  overpayment, over-refund, or attempt to edit an issued document.
- `422 Unprocessable Entity`: missing legal seller/customer/document data,
  inconsistent totals, impossible credit allocation, or an invalid explicit
  accounting configuration/preview request.
- `403 Forbidden`: role is not authorized for the requested financial action.
- Missing account mappings, a closed exercise, and unconfigured TVA do not reject
  or erase an otherwise valid commercial event. The commercial response includes
  a persisted `accountingProjection=blocked` reconciliation result for the UI.
- Errors are logged with correlation/source IDs but without sensitive tokens or
  unnecessary customer data.

## Database Migration

Create a new additive migration named after the current production tip, for
example `0053_sales_accounting_flow.sql`, with a journal timestamp newer than
deployed `0052`.

The migration will:

- add `compta.profil.fait_generateur_tva` with safe default `non_configure`;
- create the document-sequence table and uniqueness constraints;
- make draft official references nullable where required;
- add issue/audit/idempotency/snapshot fields;
- create payment, credit-note, credit-note-line, reversal, and reconciliation/
  outbox structures;
- add indexes and check constraints for positive centime amounts and legal state;
- preserve any legacy references and initialize counters only after validating
  their format and uniqueness.

The migration is forward-only and additive. Rollback is performed by restoring
the pre-deployment database backup and prior application image, not by a lossy
down migration after financial events have been recorded.

Before production migration:

1. take and verify a database backup;
2. assert the migration ledger ends at the expected deployed version;
3. count and inspect existing sales documents;
4. abort on reference conflicts or unexpected schema drift;
5. run migration in staging/temporary PostgreSQL and validate constraints;
6. deploy Core before exposing the new Web actions.

## UI Changes

- Invoice list/detail display the derived payment status, paid amount, remaining
  amount, and accounting projection status.
- Draft invoice detail exposes `Emettre` only after preflight validation.
- Issued invoice fields become read-only and expose payment and credit-note actions.
- Payment forms require amount, date, method, and the applicable reference.
- Credit-note and refund actions explain their effect before confirmation.
- Print layouts retain the current visual identity while using legal profile data.
- Navigation adds `A valider` under Comptabilite without duplicating menu config.

## Testing Strategy

Implementation follows Red-Green-Refactor for each domain behavior.

### Unit and Domain Tests

- concurrent sequence allocation and no duplicate/gap on transaction rollback;
- issue immutability and idempotent retries;
- required legal seller/customer fields and professional ICE rule;
- centime-safe partial receipts, final residual, overpayment, reversals, and refunds;
- `encaissement`, `debits`, and `non_configure` posting matrices;
- unpaid/partial/paid credit-note accounting;
- closed exercise and missing account mappings;
- derived invoice states and audit records;
- permission checks and explicit-ID bulk validation.

### Repository and Migration Tests

- migration on an empty database and a representative legacy dataset;
- uniqueness/check/foreign-key constraints;
- transaction rollback and row-lock concurrency;
- outbox/reconciliation idempotency;
- no modification of shared document storage or project document tables.

### Web and E2E Tests

- create/edit/delete draft, issue, and official-number assignment;
- official print rejection when legal data is incomplete;
- partial payment, full payment, credit note, refund, and displayed balances;
- `/compta/a-valider` selective validation and unauthorized access;
- accounting entry links back to source documents;
- responsive behavior and no console errors.

### Release Verification

```text
pnpm test
pnpm typecheck
pnpm --filter @atlas/core build
pnpm --filter @atlas/web build
targeted migration/integration tests against PostgreSQL
Playwright critical-path tests
production database backup + migration preflight
post-deploy API, UI, numbering, and reconciliation smoke checks
```

## Deployment and Activation

- Commit the parser baseline fix separately from the financial feature.
- Deploy the migration and application through the existing staging/deployment
  scripts; do not apply ad-hoc SQL directly to production.
- Keep `faitGenerateurTva=non_configure` after deployment.
- Have the authorized accountant confirm the company regime and account mappings.
- Activate the selected regime through the audited settings screen.
- Run reconciliation/backfill, review generated drafts, then validate them
  selectively.
- Monitor conflicts, blocked projections, journal balance, and migration health.

## Explicit Non-Goals

- No replacement of the current ATLAS design system.
- No deletion or repurposing of generic Finance payment data.
- No deletion of Vault/MinIO/S3/document infrastructure.
- No automatic validation of accounting entries.
- No automatic assumption of `encaissement` or `debits`.
- No retroactive mutation of validated journal entries.
- No claim that software controls replace accountant or legal review.

## Acceptance Criteria

The package is ready for production only when:

- baseline and new tests, type checks, builds, and migration checks pass;
- official numbering is server-side, transactional, unique, and issue-time only;
- issued documents and payments are append-only/auditable;
- partial payments, credits, refunds, and centime rounding are correct;
- TVA posting follows the explicitly configured taxable event;
- `non_configure` fails visibly and safely;
- all generated entries remain drafts until authorized validation;
- invoice prints contain the required configured legal fields;
- `/compta/a-valider` validates selected IDs with full audit history;
- permissions are enforced in Core;
- no shared storage or project-document workflow regresses;
- a verified backup and rollback path exist before production migration;
- post-deployment smoke tests and reconciliation show no missing or duplicate
  financial events.
