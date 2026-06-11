# AI Architecture — The ATLAS Brain

## 1. Role of AI in ATLAS

AI is not a chatbot bolted on. It is the **labor layer** of three factories:

1. **Reading factory** — turn unstructured Moroccan procurement & site documents
   (avis, RC, CPS, BPU/DQE, plans annexes, PV, décomptes, photos) into structured
   data, reliably, in French and Arabic.
2. **Drafting factory** — produce administrative dossiers, mémoires techniques,
   planning narratives, décompte cover letters, claim letters — from templates +
   structured data, never freehand legal improvisation.
3. **Judgment support factory** — score opportunities, estimate win probability,
   detect risk clauses, simulate price scenarios — always presented to a human
   decision-maker with reasoning and sources.

## 2. Model Routing (cost & capability discipline)

| Tier | Model class | Used for | Volume |
|---|---|---|---|
| T1 bulk | Haiku-class | Tender triage/classification, field extraction from avis, dedupe assist, OCR cleanup | 100s/day |
| T2 standard | Sonnet-class | DCE deep parsing, requirement extraction, compliance checklist generation, drafting from templates, debrief synthesis | 10s/day |
| T3 strategic | Opus/Fable-class | Go/No-Go briefs, pricing strategy memos, risk clause analysis on large CPS, competitor pattern analysis | A few/day |

Rules:
- Prompt caching for repeated system prompts (DCE schemas, CCAG-T reference).
- Batch API for nightly bulk jobs (re-embedding, historical PV mining).
- Per-job token budget + monthly cost dashboard in Grafana; alert at 80% budget.
- Every extraction stores: model, prompt version, input hash, confidence,
  raw output → reproducibility and regression testing of prompts.

## 3. Pipeline Architecture (the core pattern)

```
Document in (MinIO)
  → preprocess (split, OCR if scanned [PaddleOCR FR/AR], page classify)
  → extract (LLM with Zod-validated JSON schema, T1/T2 by doc type)
  → verify (rule checks: totals add up, dates parse, references exist;
            second-pass LLM check on low-confidence fields)
  → persist (typed tables + raw extraction JSONB + confidence)
  → human review queue ONLY for low-confidence or high-stakes fields
```

The same skeleton serves DCE parsing, PV/result mining, attestation reading,
décompte verification, and incoming courrier triage. Build it once, well,
in `brain/pipelines/`.

## 4. Agent Layer (Claude Agent SDK)

- Agents are **queue consumers**: a BullMQ job (`agent.run`) with a typed task
  payload; the SDK session runs with a scoped toolset; outputs are typed events.
- **Toolset per agent is allow-listed** (e.g., Sentinel may fetch portals and
  write `tender.detected`; it cannot touch `bid` or send email).
- **Hard guardrails** (enforced in code, not prompts):
  - No agent sends anything outside the company (email/portal submission) —
    drafts only, human sends.
  - No agent reads or writes price `final_offer` — scenarios only.
  - Intelligence agents consume **published** data only (integrity rule from
    security doc §4.3).
  - Every agent run is logged: inputs, tools called, outputs, cost, duration.
- Inter-agent communication: through the database and events — not free-form
  agent-to-agent chat. Deterministic orchestration (code) > emergent behavior.
- Full agent roster and hierarchy: see `20-tender-division/01-division-design.md`.

## 5. Knowledge & Retrieval

- Embeddings (pgvector) over: tender objects+CPS chunks, past mémoires,
  lessons-learned, incident reports, price book entries.
- Retrieval pattern: hybrid (FTS + vector + metadata filters: buyer, sector,
  region, year) → rerank → cite. Agents must cite source rows/documents in
  every brief; uncited claims are rejected by the output validator.
- The **price book** (`intel` + own cost data) is the most strategic retrieval
  corpus: unit prices observed by buyer/region/year, own sous-détails, supplier
  quotes. Estimator agent grounds every price suggestion in it.

## 6. Predictive Models (grow into, not start with)

| Model | Inputs | Output | Phase |
|---|---|---|---|
| Win-probability | buyer, sector, estimation, # historical bidders, our class, rabais scenario vs historical winning rabais distribution | P(win) per scenario | Phase 2 (needs ~12 months of `intel` data; start with heuristic scoring) |
| Cost-overrun risk | project type, buyer payment history, season, site region | risk score | Phase 3 |
| Payment-delay forecast | buyer, decompte size, history | expected days | Phase 3 |

Start heuristic → log predictions vs outcomes from day one → replace with
fitted models (simple logistic regression first; we have tabular data, not a
deep-learning problem) once data volume justifies it.

## 7. Evaluation & Reliability

- **Golden set**: 20+ real DCEs (accumulated) with hand-verified extractions;
  every prompt/pipeline change runs the eval suite in CI; extraction accuracy
  gates deployment (target ≥ 98% on critical fields: deadline, caution,
  qualifications, estimation).
- Production telemetry: extraction confidence distribution, human-correction
  rate per field (the true accuracy signal), agent task success rate, cost/task.
- Degradation playbook: provider outage → queue jobs pause and alert (deadline
  risk!); fallback manual workflow documented for the 48h-to-deadline case.

## 8. AI Usage Policy (company-wide)

- No confidential company data in personal/public AI tools — ATLAS endpoints only.
- AI drafts are labeled as drafts until a named human approves.
- Anthropic API: zero-retention posture verified at contract level; no training
  on our data.
- Arabic/French legal nuance: final legal wording always human-reviewed
  (lawyer for non-standard clauses, flagged by the risk agent).
