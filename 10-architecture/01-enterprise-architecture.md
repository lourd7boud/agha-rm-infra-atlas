# Enterprise Architecture — System Landscape

## 1. Architectural Style Decision

**Decision: modular monolith first, services when scale demands.**

A small company must not pay the operational tax of microservices. ATLAS Core is
one NestJS application with strictly bounded internal modules (enforced module
boundaries, separate schemas), deployable as a single unit. Modules whose load
profile diverges (scraping, OCR, AI pipelines) run as **workers** consuming
queues — same codebase, different process. When a module needs independent
scaling or an independent team (Year 3+), it is extracted along its existing
boundary.

Rejected alternatives:
- *Pure microservices from day one* — operational overkill for < 10 engineers.
- *Everything inside Odoo* — Odoo is excellent back-office but a poor host for
  scraping pipelines, AI agents and offline-first mobile sync; customizing it
  deeply creates upgrade-lock.
- *No-code/low-code (Airtable/Zapier class)* — cannot hold the moat (tender
  intelligence) and fails at scale, audit and offline requirements.

## 2. System Landscape

```
                          ┌──────────────────────────────────────────────┐
                          │              IDENTITY: Keycloak (SSO/OIDC)   │
                          └──────────────────────────────────────────────┘
                                              │
   ┌────────────────┬─────────────────┬──────┴────────┬──────────────────┐
   │                │                 │               │                  │
┌──▼─────────┐ ┌────▼────────┐ ┌──────▼──────┐ ┌──────▼───────┐ ┌────────▼──────┐
│ ATLAS Core │ │ Odoo CE     │ │ ATLAS Field │ │ ATLAS Web    │ │ Metabase      │
│ (NestJS)   │ │ (back-office│ │ (Flutter,   │ │ (Next.js,    │ │ (BI/dashboards│
│ API + jobs │ │  l10n_ma)   │ │ offline-1st)│ │ staff portal)│ │  read-only)   │
└──┬─────────┘ └────┬────────┘ └──────┬──────┘ └──────┬───────┘ └────────┬──────┘
   │                │                 │               │                  │
   └───────┬────────┴────────┬────────┴───────────────┘                  │
           │                 │                                           │
   ┌───────▼──────┐  ┌───────▼───────────────────────────┐               │
   │ PostgreSQL 16│  │ Infrastructure services:          │◄──────────────┘
   │ (+ pgvector) │  │ Redis/BullMQ (queues)             │
   │ core + odoo  │  │ MinIO (S3 object storage — GED)   │
   │ + warehouse  │  │ Playwright workers (scraping)     │
   └──────────────┘  │ Claude API + Agent SDK (AI layer) │
                     └───────────────────────────────────┘
```

## 3. ATLAS Core — Internal Module Map

| Module | Value stream | Responsibility |
|---|---|---|
| `tender` | VS1 | Tender registry, pipeline states, Go/No-Go records |
| `watch` | VS1 | Source watchers (PMMP + other portals), dedupe, normalization |
| `dce` | VS1 | DCE document ingestion, parsing, requirement extraction |
| `bid` | VS1 | Dossier assembly, compliance checklists, generated documents |
| `intel` | VS1/VS5 | Published results mining, competitor & price intelligence |
| `project` | VS2 | Chantiers, planning, attachements, situations, réceptions |
| `billing` | VS3 | Décomptes, payment tracking, intérêts moratoires, cautions lifecycle |
| `vault` | VS4 | Company document vault (attestations, qualifications) + validity tracking |
| `supply` | VS2/VS4 | Material purchasing, suppliers, fleet & equipment |
| `people` | VS4 | Site workforce (pointage), links to Odoo HR |
| `brain` | VS5 | AI orchestration, embeddings, knowledge base, agent runs |
| `analytics` | VS5 | Event capture, warehouse feeds, KPI computation |
| `auth/audit` | — | RBAC (via Keycloak), append-only audit trail |

Module rules:
- A module exposes a TypeScript interface; other modules call interfaces only.
- Each module owns its own PostgreSQL schema; cross-schema joins only in
  the read-only warehouse.
- Domain events (`tender.detected`, `bid.submitted`, `decompte.paid`…) go on the
  internal event bus (BullMQ); `analytics` subscribes to everything.

## 4. Buy vs Build Map

| Capability | Decision | Tool |
|---|---|---|
| Accounting (plan comptable marocain, TVA, IS) | **Buy/adopt** | Odoo CE + l10n_ma, local integrator for fiscal setup |
| Payroll (CNSS, AMO, IR) | **Adopt, with accountant** | Odoo or external paie provider initially; integrate later |
| BI dashboards | **Adopt** | Metabase (self-hosted) on warehouse schemas |
| Identity/SSO | **Adopt** | Keycloak |
| Document storage | **Adopt** | MinIO (S3 API) |
| E-signature for PMMP submission | **External, legal** | Barid eSign certificates held by named humans |
| Tender intelligence, bid automation | **BUILD** — the moat | ATLAS `tender/watch/dce/bid/intel` |
| Construction ops (attachements, décomptes) | **BUILD** — Morocco-specific, no good COTS | ATLAS `project/billing` |
| Field mobile app | **BUILD** | Flutter |
| AI layer | **BUILD on Claude** | Agent SDK + API |

## 5. Integration Architecture

- **Odoo ↔ ATLAS**: ATLAS is master for operational data (tenders, projects,
  décomptes); Odoo is master for ledger, invoices, payroll. Sync via Odoo
  JSON-RPC (XML-RPC fallback) through an anti-corruption layer in ATLAS
  (`integration/odoo`). Nightly reconciliation job + on-event push.
- **PMMP & portals → ATLAS**: Playwright-based watchers run on schedule (BullMQ
  cron). No portal credentials in code; stored encrypted (SOPS). Respect
  robots/ToS; throttle politely; human performs the actual e-submission.
- **ATLAS Field ↔ Core**: sync API with per-device change-log (last-write-wins +
  conflict surfacing for quantities); binary attachments to MinIO via pre-signed
  URLs.
- **Notifications**: email (SMTP) + WhatsApp Business API (ubiquitous in Moroccan
  field ops) for deadline alerts and daily digests.

## 6. Environments & Deployment Topology

| Env | Where | Purpose |
|---|---|---|
| `dev` | Developer machines (Docker Compose) | Daily development |
| `staging` | One VPS | Pre-production, agent dry-runs against recorded portal data |
| `prod` | Managed VPS or Moroccan cloud (see security doc for data residency) | Live |

Single-region active + nightly encrypted offsite backups + weekly restore drill.
Kubernetes is **deliberately deferred** until: >3 always-on services, >2 ops
engineers, or multi-region need — whichever comes first.

## 7. Scalability Strategy

1. **Vertical first** — PostgreSQL and the monolith scale far on one big box.
2. **Workers horizontal** — scraping/OCR/AI workers scale by adding queue
   consumers; they are stateless by design.
3. **Read separation** — warehouse schema + Metabase keep analytics off the
   transactional path.
4. **Extraction-ready seams** — module boundaries + event bus mean any module
   can become a service without rewrite.
5. **Multi-company/multi-country** — every core table carries `company_id`;
   currency/locale fields from day one (MAD now; XOF/EUR later).
