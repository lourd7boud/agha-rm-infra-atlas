# ATLAS Bid Participation Platform — Product and Architecture Specification

## Purpose

ATLAS is the only operator-facing interface for discovering, evaluating, preparing,
signing, submitting and following Moroccan public-procurement bids. The public portal
remains an external system of record; operators do not have to navigate it directly.

## Non-negotiable invariants

- A public tender and AGHA RM INFRA's participation are separate aggregates.
- A workspace can never be marked `submitted` without a verified official receipt.
- A frozen package is content-addressed. Changing one byte creates a new version and
  invalidates every signature belonging to the previous version.
- The private signing key never leaves the qualified USB token. PINs, portal cookies,
  tokens and private keys are never persisted in ATLAS logs or its database.
- Signing, final submission, withdrawal and guarantee-release requests require one
  explicit confirmation by an authorized human. Preparation and monitoring are
  automated.
- All commands are idempotent, versioned and auditable. Multi-step database writes are
  atomic.
- The official portal receipt, not a button click or browser success page, is the proof
  of submission.
- Estimated rank and official rank are distinct facts. Guarantee release is never
  requested from an estimated rank alone.
- Portal automation fails closed, resumes from checkpoints and never repeats a legal
  action merely because a network response was lost.

## Bounded contexts

### Bid Workspace

Owns the company's participation lifecycle, owner, signer, deadline, package version,
state, optimistic version and immutable event stream. It references a tender but never
mutates the tender's public lifecycle.

Lifecycle:

`evaluating → go/no_go → assembling → review → frozen → awaiting_signature → signing
→ signed → ready_to_submit → submitting → submitted → opened → won/lost/rejected`.

Withdrawal and guarantee-release are explicit side flows. `submitted` is reachable only
through the receipt-recording command.

### Bid Package

Owns package versions, document requirements, source vault documents, envelope mapping,
rendered files, hashes, freeze and supersession. A signature always targets exactly one
frozen package version.

### Signing

The server creates signing tasks. A Windows Signing Bridge on the authorized signer's
device claims a task, confirms the displayed package digest, asks the token middleware
to sign and uploads only signed files and certificate evidence. It never receives or
stores the token PIN.

### Portal Connector

Owns authenticated portal sessions, durable workflow checkpoints, browser/HTTP adapters,
idempotency, submission execution, receipt capture and reconciliation with Mes réponses
and Mes cautions. DOM selectors are versioned adapters, not domain logic.

### Outcome and Guarantee Orchestration

Links published commission results to our workspace, records official/estimated ranking,
notifies the operator, creates a project after a win and determines guarantee-release
eligibility only from official evidence.

## Deployment topology

- Today: ATLAS Core + Web + PostgreSQL + MinIO + Redis on the local machine; Signing
  Bridge on the same Windows machine.
- Future: Core/Web/workers move to a server. Each authorized signer installs a Bridge on
  their Windows device. Bridges use short-lived device credentials and outbound-only
  connections; the qualified token stays local.

## Delivery sequence

1. Bid Workspace source of truth and internal operator UI.
2. Versioned package assembly, requirements and freeze.
3. Portal reconciliation repairs for Mes réponses and Mes cautions.
4. Signing task protocol and Windows Signing Bridge.
5. Portal submission executor, checkpoints and official receipt ingestion.
6. Result/rank reconciliation, guarantee workflow and notifications.
7. Team delegation, device management, production hardening and disaster recovery.

Each stage ships independently with tests and preserves the invariants above.
