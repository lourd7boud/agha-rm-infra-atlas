# Technology Stack — Decisions & Rationale

Every choice below was weighed against alternatives. Format: decision, rationale,
rejected options. These are commitments, not suggestions; changes go through the
architecture council (40-execution/02-governance.md).

## 1. Languages

**TypeScript end-to-end** (backend, web, agents, scrapers) + **Dart** (mobile) +
**Python permitted** only for data science notebooks and ML experiments.

- One language = one hiring pool, shared types from DB to UI, shared validation.
- Morocco has a deep JS/TS talent pool (ENSIAS, 1337, bootcamp output).
- Claude Agent SDK and Playwright are first-class in TS.
- Rejected: Python backend (splits the stack once web/agents are TS anyway);
  Java/Spring (slower iteration for a startup-scale team).

## 2. Backend

| Concern | Choice | Rationale / rejected |
|---|---|---|
| Framework | **NestJS 11** | Enforced modularity (fits modular monolith), DI, mature ecosystem. Rejected: Express bare (no structure), Fastify bare (same), Django (Python split) |
| ORM | **Drizzle ORM** | SQL-first, lightweight, excellent migrations, no runtime magic. Rejected: Prisma (heavier engine, weaker multi-schema story), TypeORM (maintenance state) |
| Validation | **Zod** at all boundaries | One schema → types + runtime validation |
| Jobs/queues | **BullMQ on Redis** | Cron + retries + rate-limiting for scrapers/AI jobs. Rejected: Temporal (great but operational overkill now; revisit Year 3) |
| API style | **REST + OpenAPI** (generated) | Simple, cacheable, mobile-friendly. GraphQL rejected: no third-party API consumers yet |
| Realtime | **SSE** for dashboards; WebSocket only if needed | Simplicity |

## 3. Data Layer

| Concern | Choice | Rationale |
|---|---|---|
| Primary DB | **PostgreSQL 16** | One database technology for everything; JSONB for DCE extractions; full-text (french + arabic configs) |
| Vector search | **pgvector** | Embeddings live next to data; no separate vector DB to operate |
| Object storage | **MinIO** (S3 API) | DCE PDFs, photos chantier, generated dossiers; cloud-portable |
| Cache/queues | **Redis 7** | BullMQ backing + hot cache |
| Warehouse | **PostgreSQL schema `warehouse`** + SQL transforms | Same engine until data volume forces ClickHouse (revisit at ~100M event rows) |
| Search | PG full-text first | Meilisearch only if FTS proves insufficient on tender text |

## 4. Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Web framework | **Next.js 15 (App Router)** | SSR for fast dashboards, the hiring-pool default |
| UI kit | **Tailwind CSS 4 + shadcn/ui** | Speed with full ownership of components; no licence lock |
| State | TanStack Query (server state) + Zustand (client state) | Never duplicate server state into client stores |
| i18n | **next-intl**, FR primary, AR (RTL) secondary | Legal docs are FR; field users often prefer AR |
| Charts | Recharts in-app; Metabase for exploratory BI | Don't rebuild BI |

## 5. Mobile (ATLAS Field)

**Flutter** with offline-first architecture:
- Local DB: **Drift (SQLite)**; sync engine with change-log + server reconciliation
- Riverpod for state; GoRouter for navigation
- Targets: Android first (dominant on Moroccan sites), iOS later
- Hard requirements: works 100% offline; photos geotagged + timestamped (proof
  for attachements); FR/AR UI with RTL; runs on low-end devices (≤ 2GB RAM)
- Rejected: React Native (weaker offline/SQLite maturity for this profile),
  PWA (camera/offline reliability on cheap Androids is inadequate)

## 6. AI Stack

| Concern | Choice | Rationale |
|---|---|---|
| LLM provider | **Claude API** (Anthropic) | Best-in-class long-document understanding (DCE PDFs), strong French; Agent SDK for the division |
| Model routing | Haiku → bulk extraction/classification; Sonnet → analysis, drafting; Opus-class → Go/No-Go briefs, pricing strategy memos | Cost discipline (see 05-ai-architecture.md) |
| Agent framework | **Claude Agent SDK (TS)** | Tool-use, sub-agents, MCP integrations |
| Embeddings | Embedding API (e.g., Voyage) → pgvector | Semantic search over tenders/knowledge |
| OCR | **PaddleOCR self-hosted** (FR+AR) with cloud OCR fallback for hard scans | Most DCE PDFs are digital; scans exist (old PVs, attestations) |
| Doc generation | docxtemplater/Carbone for DOCX; Gotenberg for PDF | Administrative dossiers are DOCX/PDF |

## 7. Infrastructure & Operations

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Docker Compose** on managed VPS (prod = 1 strong box + 1 backup box) | Minimal ops burden; K8s deferred deliberately |
| Hosting | Start: European VPS (OVH/Hetzner). Sensitive-data posture & Moroccan options (N+ONE, Atlas Cloud Services) in 04-security-compliance.md | Cost/maturity now, residency path later |
| CI/CD | **GitHub Actions** → build, test, push images, deploy via SSH | Default choice, zero server to maintain |
| Secrets | **SOPS + age** encrypted in repo; runtime via env injection | Simple, auditable; Vault when team grows |
| Observability | **Grafana + Prometheus + Loki** stack + **Sentry** (errors) | Self-hosted, one compose file |
| Backups | pgBackRest nightly + MinIO replication offsite + weekly restore test | A backup that isn't restored is a rumor |
| VPN/access | **Tailscale** for admin access; no admin port on public internet | Zero-trust posture cheaply |

## 8. Monorepo Layout (target)

```
atlas/
├── apps/
│   ├── core/          # NestJS API + workers
│   ├── web/           # Next.js staff portal
│   └── field/         # Flutter app (own toolchain, same repo)
├── packages/
│   ├── contracts/     # Zod schemas + generated OpenAPI types (shared)
│   ├── agents/        # Claude Agent SDK division code
│   └── ui/            # shared web components
├── platform/          # docker-compose, infra config (this repo's /platform seeds it)
└── docs/              # this documentation corpus migrates here
```

Tooling: pnpm workspaces + Turborepo; ESLint + Prettier; Vitest (unit),
Playwright (E2E); 80% coverage gate on `core` business logic.

## 9. Revisit Triggers (pre-committed)

| Trigger | Re-evaluate |
|---|---|
| > 50 concurrent staff users or > 5 engineers | Extract `watch`+`dce` workers to separate service |
| Analytics queries degrade OLTP | ClickHouse for warehouse |
| Multi-country live | Kubernetes + multi-region, Vault |
| PMMP offers official API | Replace scraping watchers with API client |
| Odoo customization pressure > 20% of modules touched | Reassess ERP strategy (ERPNext or deeper custom) |
