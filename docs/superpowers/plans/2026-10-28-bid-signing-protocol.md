# Bid Signing Task Protocol Implementation Plan

**Goal:** Turn one frozen, content-addressed bid package into a securely claimed local signing task without ever moving the certificate private key or PIN to ATLAS.

**Architecture:** Core owns durable signing tasks and one-time bridge pairing secrets. The Windows bridge uses outbound HTTPS, claims exactly one task, downloads only the immutable package files, invokes a token-specific local driver, and uploads signed artifacts plus certificate evidence. Core verifies task/package identity, file hashes and optimistic workspace state before accepting completion.

**Non-negotiable invariants**

- A task can only target the workspace's current frozen package and exact manifest SHA-256.
- Pairing and lease secrets are returned once; only SHA-256 hashes are stored.
- A task claim is exclusive, expires, and cannot be replayed after completion/cancellation.
- The PIN and private key are never accepted by any Core endpoint or persisted in logs/DB.
- Signing completion is a specialized atomic command; generic workspace transitions remain blocked.
- Signed artifacts never overwrite frozen input objects.
- The bridge adapter remains vendor-specific; no claim of qualified signing is made until the real token/middleware is validated.

## Delivery tasks

1. Add contracts, signing tables and migration constraints.
2. Implement pure secret/hash/state rules and transactional repository.
3. Add operator create/cancel endpoints and task-scoped bridge claim/status endpoints.
4. Add immutable input download and signed artifact upload/integrity verification.
5. Add participation UI for signer assignment, one-time pairing and task state.
6. Build the Windows bridge shell with a driver boundary and a safe diagnostic driver; validate the real cryptographic driver after the USB token arrives.
7. Add PostgreSQL concurrency tests, security review, full verification and deployment smoke tests.
