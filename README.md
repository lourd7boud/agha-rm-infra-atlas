# ATLAS — Enterprise Operating System of AGHA RM INFRA

**ATLAS** (AGHA Total Logistics & Administration System) is the complete, AI-driven
enterprise operating system of AGHA RM INFRA — a Moroccan company operating in
construction, public works, infrastructure, hydraulic & agricultural development,
engineering services and public procurement.

This repository is the **single source of truth** for the company's architecture,
systems, agents, processes and execution framework. It is designed to take the
company from a small Moroccan contractor to a national, then international,
AI-native enterprise — thinking in decades, not weeks.

---

## What is LIVE today (working software, all live-verified)

| Division | Surface |
|----------|---------|
| **Tender Intelligence** — 12 agents (Sentinel, Extractor, Qualifier, Strategist, Compliance, Bid Writer, Estimator, Financial Modeler, Result Miner, Competitor Profiler, Risk Assessor, Chef d'Orchestre) + human gates G0–G3 | `/api/tender`, `/api/brain`, `/api/intel`, `/api/watch` |
| **Construction ops** — chantiers, situations de travaux (CCAG-T décompte engine: retenue 10% capped 7%), avenants moving the ceiling | `/api/project` |
| **Finance** — cautions register (locked cash), receivables aging from validated décomptes | `/api/finance` |
| **Field** — journal de chantier (terrain role writes daily reports) | `/api/field` |
| **Comms** — morning digest + outbox delivery (pluggable transports) | `/api/digest` |
| **Staff portal** — dashboard, deadline wall, dossier/G1, chantiers, trésorerie, vault, concurrence (9 screens) | `apps/web` (Next 15) |
| **Ops** — Keycloak OIDC + roles, audit trail, rate limits, Prometheus/Grafana, daily pg backups + restore drill, production Dockerfiles | `platform/` |

Monorepo: `apps/core` (NestJS 11 + Drizzle/PostgreSQL 16, migrations 0000–0008,
130+ unit tests), `apps/web` (Next.js 15), `packages/contracts` (Zod).

## Repository Map

| Path | Content |
|------|---------|
| [apps/core/](apps/core/) | ATLAS Core — API, agents, domain engines (NestJS) |
| [apps/web/](apps/web/) | Staff portal (Next.js 15 + Auth.js) |
| [packages/contracts/](packages/contracts/) | Shared Zod schemas |
| [00-foundation/](00-foundation/) | Vision, business architecture, operating model |
| [10-architecture/](10-architecture/) | Enterprise, technology, data, security and AI architecture |
| [20-tender-division/](20-tender-division/) | The Tender Intelligence Division — agents, workflows, market intelligence (Moroccan public procurement) |
| [30-modules/](30-modules/) | Functional module specifications (ERP, projects, field, HR, finance, CRM…) |
| [40-execution/](40-execution/) | Roadmap, governance model, build sequence |
| [platform/](platform/) | Deployable infrastructure + backups + observability (Docker Compose) |

## Reading Order

1. `00-foundation/01-executive-blueprint.md` — what we are building and why
2. `10-architecture/01-enterprise-architecture.md` — the system landscape
3. `10-architecture/02-technology-stack.md` — every technology decision, with rationale
4. `20-tender-division/01-division-design.md` — the revenue engine (build this first)
5. `40-execution/01-roadmap.md` — phased path from zero to full deployment

## Non-Negotiable Principles

1. **Cash funds the build** — the Tender Division ships first because winning
   marchés publics finances every other module.
2. **Own the moat, buy the commodity** — back-office (accounting, payroll) runs on
   proven open source (Odoo); tender intelligence and construction ops are
   custom-built and never outsourced.
3. **One identity, one data spine** — Keycloak SSO and PostgreSQL everywhere;
   no system is allowed to become an island.
4. **Offline-first field operations** — Moroccan worksites have unreliable
   connectivity; the mobile layer must work without network and sync later.
5. **AI prepares, humans sign** — every agent output that creates legal or
   financial commitment passes a human gate (Go/No-Go, signature, submission).
6. **French/Arabic by design** — UI, documents and OCR pipelines handle FR + AR
   (including RTL) from day one.
7. **Knowledge compounds** — every tender, price, décompte and incident is
   captured as structured data; the company's memory is its advantage.

## Status

- **Phase**: 0 — Foundation (architecture complete, infrastructure scaffold ready)
- **Next action**: see [40-execution/03-build-sequence.md](40-execution/03-build-sequence.md)
