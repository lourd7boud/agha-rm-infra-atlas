# Storage and preservation audit — 2026-11-08

This follow-up continued safe cleanup while the accountant's four sales/TVA
account codes remain pending. TVA is already set to `encaissement`; no account
codes, accounting entries or application data were changed during this audit.

## What occupies the space

Docker reported the current MinIO volume at approximately **37.7 GB** and the
operational PostgreSQL volume at **1.851 GB**. Authenticated, read-only S3 listing
using the application's existing internal endpoint found exactly **5,300 objects**
and **37,693,277,155 bytes** in `atlas-vault`:

| Object prefix | Objects | Bytes |
| --- | ---: | ---: |
| dossiers | 4,888 | 36,118,689,431 |
| btp | 362 | 1,512,074,005 |
| compta | 32 | 57,721,801 |
| autre | 7 | 4,173,723 |
| registre_commerce | 1 | 432,674 |
| bid | 1 | 154,234 |
| legal-doc-text | 9 | 31,287 |

Bucket versioning is not enabled and there are zero incomplete multipart uploads.
The large volume therefore principally represents stored dossier/BTP files, not
accumulated S3 versions or unfinished uploads. This is not a per-object necessity
or database-reference audit; no S3 objects were deleted. Database, vault,
backups, other projects' volumes and rollback images were retained.

## Rebuilt obsolete local dependencies

The main checkout's `node_modules` measured approximately **3.36 GiB** and retained
obsolete Next.js 15.5.21 packages/platform binaries absent from the current lock.
The active Web dependency already referenced Next.js 15.5.29.

With no local project Node process active, the old dependency directory was moved
within the workspace to a temporary rollback location. A fresh
`pnpm install --frozen-lockfile` reused the package store and installed the locked
451 packages. New dependencies were validated before deleting the old directory.

The fresh directory contains **660,194,674 bytes (0.615 GiB)**. Its roughly
**2.75 GiB logical reduction** is not a promise of an identical physical disk
reduction: package files can be hard-linked and Docker/Windows allocation differs.
Subsequent `pnpm store prune` removed 216 unreferenced packages / 1,312 files.
The temporary dependency backup was removed; package manifests and lockfile are
unchanged. The active Next version remains 15.5.29 and Vitest remains 4.1.12.

The other source worktrees were not deleted. Their unique tracked dirty edits
were saved as reviewed, reversible patches in
[the preservation archive](archives/2026-11-08-parser-worktrees/README.md), including
the original branch and base commit. All four reverse checks passed and independent
review found no credentials or unfinished independent capability. Equivalent
runtime parser fixes were already present in the released application.

## Verification

- Full workspace suite after fresh install: Core 1,378, Web 158, signing bridge 10,
  preview 3 passed. The 36 environment-dependent database cases are skipped in
  this host run; their separate PostgreSQL verification is documented in the
  [release review](sales-accounting-local-review.md).
- All workspace TypeScript checks passed.
- Old dependency deletion and package-store pruning completed; active CLI version
  checks and manifest/lockfile integrity checks passed afterwards.
- Core health returned `ok`, Web login returned HTTP 200 and the existing running
  application containers remained healthy. No rebuild/redeployment was required
  for these documentation and local dependency-cache changes.

GB in Docker's figures is decimal; local folder GiB is binary. Folder totals count
logical file lengths and should not be added blindly to image/cache/volume sizes.
