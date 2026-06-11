# Implementation Roadmap — Zero to Full Deployment

Sequencing principle: **revenue first, then margin protection, then scale.**
Each phase has entry/exit criteria; no phase starts before the previous phase's
exit criteria are signed off (governance doc). Durations assume 1–2 engineers +
external help; compress with budget, never reorder.

## Phase 0 — Foundation (Months 0–2)

**Goal**: secure, observable platform + the document vault + back-office basis.

| Deliverable | Detail |
|---|---|
| Platform up | Docker Compose stack (see /platform): PostgreSQL, Redis, MinIO, Keycloak, Caddy, observability, backups **with restore test** |
| Monorepo scaffold | `atlas/` per tech-stack §8; CI (lint, test, build, deploy); secrets via SOPS |
| ATLAS Core skeleton | NestJS + Drizzle + first schemas (`vault`, `tender` shell); audit + RBAC plumbing |
| **Vault MVP** | Upload, classify, validity tracking, alert ladder, readiness score; company's real documents loaded |
| Odoo CE live | l10n_ma accounting configured with the fiduciaire; users onboarded |
| Security baseline | MFA, Tailscale admin, backup drill #1 passed |

**Exit**: company bids on a real tender using vault-produced documents;
restore drill passed; CNDP groundwork started.

## Phase 1 — Tender Division MVP (Months 2–6) ← THE BET

**Goal**: every relevant tender seen, qualified and prepared in ATLAS.

| Month | Deliverable |
|---|---|
| M2–3 | Sentinel (PMMP watcher) + tender registry + deadline wall UI; daily digest |
| M3–4 | Extractor (avis/RC/CPS parsing pipelines + eval golden set); Qualifier vs company profile |
| M4–5 | Compliance Officer (per-RC checklist + dossier assembly from vault + DOCX generation); Strategist scoring v1 (heuristic) + G1 brief |
| M5–6 | Result Miner + buyer/competitor base tables; Financial Modeler v1 (scenarios + heuristic win-prob); full G0–G3 gate workflow live |

**Exit criteria**: 3 consecutive real tenders fully prepared through ATLAS;
coverage audit ≥ 90%; zero administrative non-conformity; cost/dossier measured.

## Phase 2 — Build & Bill (Months 6–12)

**Goal**: protect margin on what Phase 1 wins.

- `project` module: OS registry, attachements (web first), journal de chantier,
  réceptions; **ATLAS Field v1** (Android): pointage photos, attachement
  capture, journal — offline-first.
- `billing`: décompte generator + payment tracking + cautions register +
  intérêts moratoires calculator.
- Bid Writer + Estimator agents (price book v1 from accumulated quotes + intel).
- Win-prob v2 (fitted on accumulated outcomes); C3 Risk Assessor live.
- Odoo deep link: analytic accounting per chantier; décompte ↔ invoice mirror.

**Exit**: one real chantier run end-to-end (OS → attachements → décompte →
payment tracked); mobile used daily on site; DSO baseline established.

## Phase 3 — Full Operating System (Months 12–18)

- `supply` (purchasing, fleet, fuel), `people` (pointage → CNSS feed, CNDP
  declarations done), `crm` light, dashboards full build-out.
- Predictive models v1: payment-delay, cost-overrun risk.
- Moroccan hosting migration for personal-data workloads (residency posture).
- Process certification readiness (ISO 9001 path — helps technical scoring).

**Exit**: paper/Excel retired from daily ops; monthly close in 5 days;
KPI dashboard drives the monthly review.

## Phase 4 — Scale & Intelligence (Months 18–30)

- Multi-entity (second company/BET), consolidated reporting.
- Forward radar (programmes prévisionnels → pre-positioning), quarterly market
  review auto-generated.
- Advanced pricing: révision des prix optimization, portfolio bidding strategy
  (capacity-aware Go/No-Go across simultaneous tenders).
- Workers/services extraction where load demands; K8s if triggers met.
- Groupement playbooks; class upgrade campaign driven by références data.

## Phase 5 — Expansion (Months 30+)

- West Africa entry analysis (UEMOA procurement portals) — reuse
  Sentinel/Extractor architecture on new sources; multi-currency, multi-locale.
- Private-sector line (real estate/industry) — CRM grows up; BIM evaluation.
- ATLAS as product? (licensing the tender platform to non-competing SMEs) —
  strategic decision for Direction, architecture already multi-tenant-ready.

## Budget Posture (order of magnitude, MAD/year)

- Infra (VPS, backups, observability): 30–60k
- AI API: 60–180k (scales with division throughput; capped per ai-arch §2)
- Tools/licences (minimal — open-source-first): 20–40k
- Engineering: the dominant cost; 1 senior + 1 mid in-house preferred over
  agency for the moat modules; agency acceptable for Odoo setup & Field app v1.

**Total non-payroll run-rate target: < 1 high-end engineer's salary.** The
system must pay for itself with ~1 additional won tender per year — it will.
