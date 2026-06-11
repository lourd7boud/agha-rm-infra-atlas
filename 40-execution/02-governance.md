# Governance Model

## 1. Decision Rights

| Decision | Owner | Consulted |
|---|---|---|
| Go/No-Go, final price, submission (G1–G3) | Direction Générale | Resp. Marchés, agents' briefs |
| Architecture changes (stack, module boundaries) | Architecture Council | Engineering |
| New agent / agent authority change | Architecture Council + Direction sign-off | Resp. Marchés |
| Data access grants (roles) | DAF (process owner) + admin-SI (executor) | — |
| Budget (infra, AI, tooling) | Direction, quarterly envelope | admin-SI |
| Compliance posture (CNDP, fiscal, marchés) | DAF | Fiduciaire, avocat, admin-SI |

**Architecture Council** = Direction + lead engineer + (external advisor as
needed). Meets quarterly or on-demand; decisions recorded as ADRs
(architecture decision records) in the repo — including rejected options.

## 2. Operating Rituals

| Ritual | Cadence | Content | Input artifact |
|---|---|---|---|
| Pipeline digest | Daily 07:30 | New tenders, deadlines, blockers, expiring docs | Auto-generated |
| Go/No-Go committee | Weekly (or per-deadline) | G1 decisions on qualified tenders | A4 briefs + C3 memos |
| Chantier/cash review | Weekly | Avancement vs facturation, attachements pending, décomptes aging | Travaux + cash boards |
| Monthly business review | Monthly | KPIs vs targets, win/loss analysis, incident review | Auto-report + debriefs |
| Architecture council | Quarterly | ADRs, revisit-triggers check, security review, AI eval trends | Council pack |
| Restore & incident drill | Monthly / quarterly | Backup restore test; tabletop incident exercise | Runbooks |

## 3. Change Management (the human side — where ERPs die)

- **One workflow at a time**: a module replaces a specific Excel/WhatsApp
  practice entirely for one pilot tender/chantier before general rollout.
- **The boss uses it first**: Direction runs Go/No-Go from ATLAS from day one —
  tools the chief ignores, die.
- Field adoption: AR/FR UI, 3-tap workflows, offline always, and **the app must
  give before it takes** (chef de chantier gets his planning & contacts before
  he's asked to enter pointage).
- Training: 30-minute sessions per role, recorded; cheat-sheets laminated for
  site offices; a named "champion" per direction.
- Resistance protocol: if a workflow is bypassed twice, the workflow is wrong —
  fix the workflow, don't blame the user (then enforce).

## 4. Engineering Governance

- All code in the monorepo; PRs reviewed (code review + security gates per
  company rules); 80% coverage on core business logic; eval suite green for
  any prompt/pipeline change.
- ADR required for: new dependency with lock-in risk, schema ownership changes,
  any new external data flow (security review).
- Vendor independence audit yearly: can we leave Odoo/provider X within 6
  months? Exports tested.
- Documentation is part of done: module README + runbook + dashboard per module.

## 5. KPI Tree (what the monthly review reads)

```
Enterprise value
├── WIN   : coverage %, G1 throughput, win rate, rabais gap, bid cost, 0-defects
├── BUILD : margin fidelity (est vs real), avancement vs planning, attachement lag
├── COLLECT: DSO, décomptes aging > 90d, cautions idle, IM claimed/recovered
├── SUPPORT: close speed, payroll accuracy, fleet downtime
├── LEARN : extraction accuracy, human-correction rate, win-prob calibration
└── RISK  : compliance readiness score, backup drill pass, incident count/severity
```

Targets set yearly by Direction; the dashboard shows target vs actual vs trend —
no vanity metrics.

## 6. Agent Governance (specific)

- Every agent has an owner (human) accountable for its output quality.
- Agent authority matrix versioned in repo; expanding an agent's toolset is an
  ADR-level change.
- Monthly agent report: cost, task success rate, correction rate, incidents.
- Kill switch: any agent can be paused instantly (queue pause) without
  affecting the rest; manual SOPs exist for every agent's function.
