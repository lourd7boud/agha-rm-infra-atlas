# Build Sequence — Concrete Next Actions

The bridge from this corpus to running software. Ordered; each step small
enough to verify. (Items marked ☐ are pending, ☑ done.)

## Step 0 — Repository & Infrastructure (Week 1)

- ☑ Architecture corpus (this repository)
- ☑ `platform/` Docker Compose seed (postgres, redis, minio, keycloak, caddy,
  metabase, odoo) + `.env.example`
- ☐ Initialize git; private remote (GitHub org `agha-rm-infra`); branch
  protection; CI skeleton
- ☐ Provision staging VPS; run the compose stack; Tailscale up; TLS up
- ☐ Backup job + **first restore test** (gate: nothing else proceeds until green)

## Step 1 — Monorepo & Core Skeleton (Weeks 2–3)

- ☐ `atlas/` pnpm + Turborepo workspace per tech-stack §8
- ☐ `apps/core`: NestJS + Drizzle + Keycloak OIDC guard + audit interceptor +
  health endpoints + OpenAPI
- ☐ `packages/contracts`: Zod schema conventions; first domain: vault
- ☐ `apps/web`: Next.js shell with SSO login, role-aware nav, FR i18n base
- ☐ CI: lint, typecheck, unit tests, docker build, deploy-to-staging

## Step 2 — Vault MVP (Weeks 3–5)

- ☐ `vault` schema + upload (AV scan, sha256, MinIO) + classification
- ☐ Validity engine + alert ladder (email/WhatsApp) + readiness score endpoint
- ☐ Load the company's real documents; DAF trained (30 min)
- **Gate**: produce a complete dossier administratif folder for a real tender
  from vault in < 5 minutes

## Step 3 — Tender Registry + Sentinel (Weeks 5–8)

- ☐ `tender` schema + pipeline state machine + deadline wall UI
- ☐ Playwright watcher for PMMP search results (company's secteurs/régions),
  polite throttling, dedupe, DCE download to MinIO
- ☐ Daily digest (07:30) to Direction; coverage audit procedure
- **Gate**: one week of detection with zero missed relevant tenders vs manual

## Step 4 — Extractor + Qualifier (Weeks 8–12)

- ☐ `brain` pipeline skeleton (per ai-arch §3) + golden-set eval harness in CI
- ☐ Avis/RC extraction (T1) → CPS deep-parse (T2); confidence routing to
  review queue UI
- ☐ Company profile (qualifications held, capacity) + Qualifier rules + G0 queue
- **Gate**: ≥98% accuracy on critical fields over 20-DCE golden set

## Step 5 — Compliance Officer + G1 Workflow (Weeks 12–16)

- ☐ Per-RC checklist generation; dossier assembly (vault docs + docxtemplater
  outputs); missing-doc escalations
- ☐ Strategist scoring v1 + G1 brief template; gate decisions recorded
- **Gate**: first real tender fully prepared in ATLAS, submitted by signatory

## Step 6 — Intelligence Base + Financial Modeler (Weeks 16–24)

- ☐ Result Miner nightly job + entity resolution + buyer/competitor tables
- ☐ Financial Modeler scenarios + heuristic win-prob + G2 workflow
- ☐ Division KPI board; Phase 1 exit review vs criteria (roadmap §Phase 1)

## Working Agreements for the Build

- TDD on business logic (qualification rules, validity engine, décompte math
  later) — these are the functions whose bugs cost tenders and money.
- Every scraper ships with recorded-fixture tests (portal HTML snapshots) so
  layout changes break CI, not production silently.
- Every agent ships with: eval cases, cost telemetry, kill switch, manual SOP.
- Definition of done per step: deployed to staging + used once with real data +
  runbook written + demo to Direction.

## Immediate Human Actions (non-software, start now)

1. Inventory & scan all company legal documents (vault seeding list).
2. Confirm PMMP account, alert settings, and signatory's Barid eSign
   certificate validity.
3. Fiduciaire meeting: Odoo l10n_ma setup scope + payroll responsibility split.
4. CNDP groundwork (DAF): processing register skeleton.
5. Open the engineering hire (1 senior TS full-stack, Rabat/Casa/remote).
