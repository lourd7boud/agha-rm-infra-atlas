# Tender Intelligence Division (Division Marchés) — Design

The strategic division for Moroccan public procurement. It runs value stream
VS1 (WIN) end-to-end with **11 specialized AI agents + 1 orchestrator**,
organized in three desks, supervised by humans at four decision gates.

## 1. Division Charter

- **Mission**: see every relevant Moroccan public tender, qualify ruthlessly,
  prepare flawless dossiers fast, price with market intelligence, and learn from
  every outcome.
- **Authority**: agents prepare and recommend; humans decide and sign (gates §4).
- **Coverage**: PMMP (marchespublics.gov.ma) as primary; buyer-specific portals
  (ONEE, OCP, ONCF, ADM, ORMVAs, agences urbaines, ABHs); programmes
  prévisionnels; press/BO for concessions and special procedures.
- **Integrity rule**: published data only; no insider information, no collusive
  contact. Enforced as a code-level guardrail and a human policy.

## 2. Agent Roster

### Desk A — Discovery & Qualification (runs daily, mostly T1/T2 models)

| # | Agent | Responsibility | Key outputs |
|---|---|---|---|
| A1 | **Sentinel** | Watch all sources on schedule; detect new/modified/cancelled avis; download documents; dedupe & normalize | `tender.detected`, DCE files in MinIO |
| A2 | **Extractor** | Parse avis + RC + CPS + BPU/DQE into structured Tender record (deadline, caution, estimation, qualifications required, visite des lieux, échantillons, lots, criteria) | Parsed Tender + confidence map |
| A3 | **Qualifier** | Hard-filter against company profile (qualifications/classes held, caution capacity, geography, workload); compute eliminatory checklist | qualified / rejected + reasons |
| A4 | **Strategist** | Score qualified tenders (fit, margin potential, competition density from intel, strategic value, capacity); rank pipeline; draft Go/No-Go brief with cited evidence | Opportunity score + G1 brief |

### Desk B — Bid Factory (activates on Go decision, T2 models + templates)

| # | Agent | Responsibility | Key outputs |
|---|---|---|---|
| B1 | **Compliance Officer** | Generate the exact administrative checklist for THIS tender (per RC); pull valid documents from vault; flag missing/expiring ones; final conformity audit before submission | Checklist + dossier administratif draft |
| B2 | **Bid Writer** | Draft mémoire technique, méthodologie, planning, moyens humains & matériels — grounded in company references and similar past bids | Offre technique drafts |
| B3 | **Estimator** | Quantity & cost build-up: BPU/DQE lines priced from price book (own sous-détails, supplier quotes, intel unit prices); flag abnormal quantities or risky lines | Cost baseline + sous-détail des prix |
| B4 | **Financial Modeler** | Price scenarios (margin %, rabais vs estimation), win-probability per scenario (from intel distributions), cash curve (caution, retenue, délais paiement) | Scenario table for G2 |

### Desk C — Intelligence (continuous background, feeds A4/B3/B4)

| # | Agent | Responsibility | Key outputs |
|---|---|---|---|
| C1 | **Result Miner** | Harvest published PV, résultats définitifs, extraits de jugement; extract all bidders, amounts, winner, rabais | `intel.competitor_bid` rows |
| C2 | **Competitor Profiler** | Maintain competitor profiles: who bids where, win rates, typical rabais bands, qualification classes, capacity signals (OMPIC data) | Competitor dossiers |
| C3 | **Risk Assessor** | Read CPS/CCAG deviations: penalty clauses, payment terms, atypical obligations (échantillons, délais courts, variantes), buyer payment-behavior history; output risk grade + red flags | Risk memo per tender |

### Orchestrator

| Agent | Responsibility |
|---|---|
| **Chef d'Orchestre** | Owns pipeline state machine; schedules desk work back from deadline (J-X plan per tender); escalates blockers (missing doc, late estimate) to humans via digest + WhatsApp alert; compiles daily division digest; never makes Go/No-Go or price decisions |

**Why 12 total**: each agent maps to one bounded responsibility with its own
toolset and one primary output table — small enough to test and evaluate
individually, large enough to avoid coordination overhead. New niches (e.g., a
Groupement Negotiation Assistant) are added as needs prove out, via governance.

## 3. Hierarchy & Communication

```
                       DIRECTION GÉNÉRALE (human)
                              │  G1 Go/No-Go · G2 Prix · G3 Soumission
                  RESPONSABLE MARCHÉS (human, division head)
                              │  reviews briefs, owns gates prep, corrects agents
                       CHEF D'ORCHESTRE (agent)
              ┌───────────────┼────────────────┐
          Desk A           Desk B            Desk C
       A1 A2 A3 A4       B1 B2 B3 B4        C1 C2 C3
```

- Agents communicate **only through typed records and domain events** (no
  free-form agent chat): A1 emits `tender.detected` → A2 consumes → emits
  `tender.parsed` → A3 → `tender.qualified` → A4 → `gate.G1.ready` …
- Human interface: ATLAS Web pipeline board + daily digest (07:30) + real-time
  alerts for deadline-critical events.
- Every agent output carries: confidence, sources/citations, model + prompt
  version, cost. Low-confidence fields route to the human review queue.

## 4. Human Decision Gates

| Gate | Question | Decider | SLA |
|---|---|---|---|
| **G0** Qualification override | Agent rejected/qualified — humans may overrule | Responsable Marchés | daily review |
| **G1** Go/No-Go | Do we bid? (A4 brief + C3 risk memo) | Direction + Resp. Marchés | within 48h of brief |
| **G2** Price approval | Which scenario, final rabais? (B4 table) | Direction | J-3 before deadline |
| **G3** Submission | Dossier conformity sign-off + e-submission via PMMP with personal certificate | Named signatory | J-1 |

Gate decisions are recorded (who, when, why) — this is both governance and
training data for better scoring.

## 5. Division KPIs

- Coverage ≥ 95% of relevant published tenders (audited monthly by sampling)
- Time from publication → parsed record < 4h (business hours)
- G1 brief quality: % of Go decisions humans take without requesting rework
- Dossier defects: administrative non-conformity eliminations = **0**
- Win rate per segment; rabais accuracy (our price vs winning price gap)
- Cost per dossier (agent cost + human hours) — target −60% vs manual baseline

## 6. Failure & Degradation Modes

- Portal layout change → Sentinel extraction tests fail → alert + manual
  watch procedure (documented runbook) until fixed; deadlines never missed
  silently.
- LLM provider outage → pipeline pauses with loud alert; manual checklist
  workflow (printed SOP) covers any tender within 48h of deadline.
- Agent error discovered post-hoc → incident debrief; eval case added to golden
  set; prompt/code fix; rerun affected tenders.
