# BDC Autonomous Pricing Agent — Design

**Date:** 2026-07-20  
**Status:** Proposed for implementation  
**Scope:** Moroccan purchase orders (`bons de commande`) covering works, supplies, and services

## 1. Objective

Replace the current lexical price matcher behind **Chiffrer automatiquement** with an evidence-first pricing agent that can:

- understand every parseable BDC line, including long technical specifications;
- price works, supplies, and services using category-specific cost models;
- use verified internal history and current Moroccan web prices;
- preserve manually entered prices and save its work as a draft for human review;
- maintain a minimum 15% markup on estimated cost when no administrative estimate is known;
- apply category-aware administrative-estimate safeguards when an estimate is known;
- explain every price with provenance, freshness, confidence, and warnings;
- learn from approved prices, supplier quotations, invoices, actual execution costs, and award results.

The agent is intended to improve the probability of submitting a competitive and executable offer. It cannot guarantee an award because competitor behavior, buyer decisions, technical compliance, and undisclosed information remain outside the system.

## 2. Current Problem

The current implementation:

1. loads BPU lines, sales quotes, previous BDC responses, and a small web-side marketplace catalogue;
2. tokenizes each designation;
3. selects the single candidate above a fixed lexical threshold (`0.42`);
4. leaves the price at zero if no candidate passes.

It does not perform semantic specification analysis, unit conversion, inflation or location adjustment, current web research, multi-source aggregation, cost decomposition, uncertainty estimation, legal-band checks, or outcome-based learning. The screenshot case therefore reports no reliable match even after comparing 341 prices.

## 3. Approved Product Decisions

- Cover all three categories: **works, supplies, and services**.
- Use a hybrid, evidence-first agent; an LLM may interpret but may not invent an unaudited final number.
- When no administrative estimate exists, use estimated market cost plus a **minimum 15% markup on cost**, consistent with the existing `coût + marge` UI.
- Fill only zero-priced lines. Never overwrite a manual price.
- Save agent output as a **draft**, never as ready-to-submit.
- Use traceable Moroccan sources with URL, observation date, unit, tax basis, and confidence.
- Learn only from verified facts and approved outcomes, never from unapproved model predictions.
- Human review remains mandatory before marking the response ready or submitting it.

## 4. Regulatory Pricing Guard

The pricing policy distinguishes profitability from procurement-price safeguards.

- **Profitability floor:** `cost × 1.15` when the line is based on cost.
- **Administrative estimate known:** the total offer is checked against the configured category corridor.
  - Works: advisory lower bound `E × 0.80`, upper bound `E × 1.20`.
  - Supplies and non-study services: advisory lower bound `E × 0.75`, upper bound `E × 1.20`.
- **Administrative estimate absent:** no legal corridor is claimed; the agent uses evidence-backed cost and margin.
- A policy version and the legal basis used are stored with every run.

These thresholds reflect the excessive/anomalously-low provisions in Morocco's Decree 2-22-431 for public contracts. Applicability to a specific BDC must be treated as an advisory compliance check, not an automatic legal conclusion. Source: [official TGR publication](https://www.tgr.gov.ma/wps/wcm/connect/1f3081fc-2d01-41de-8339-9a2c7de0480f/DECRET%2B2-22-431%2BFR.pdf?MOD=AJPERES).

If the cost floor exceeds the upper competitive/legal threshold, the agent must return **non viable** and preserve the profitable price. It must never silently reduce the markup below 15%.

## 5. Architecture

### 5.1 Asynchronous workflow

Pricing can involve multiple network and LLM calls, so it runs in the dedicated worker through BullMQ.

```text
Web UI
  -> POST pricing run
  -> Core validates and queues the run
  -> Worker analyzes, retrieves evidence, estimates, and decides
  -> Core persists line decisions and draft prices
  -> Web polls or streams run progress and renders the audit trail
```

The existing synchronous `/bdc/avis/:id/proposer` endpoint remains temporarily available for rollback, but the UI moves to the new pricing-run API.

### 5.2 Components

#### `BdcPricingOrchestrator`

Owns run state and stage transitions. It never implements category pricing itself.

Stages:

1. `analyse`
2. `recherche_interne`
3. `recherche_marche`
4. `normalisation`
5. `estimation`
6. `optimisation`
7. `brouillon_enregistre`

#### `BdcLineAnalyzer`

Uses deterministic parsing first and structured LLM output second. For every line it returns:

- category and subcategory;
- normalized item/work/service identity;
- quantity and canonical unit;
- relevant dimensions, grade, brand/equivalence, included operations, and exclusions;
- location and delivery/execution constraints;
- a decomposition request when the line is composite.

External page content is data, never instructions. The analyzer accepts a strict JSON schema and ignores embedded prompt-like text.

#### `PriceEvidenceService`

Queries all evidence adapters behind a common interface:

```ts
interface PriceEvidenceAdapter {
  search(query: NormalizedPricingQuery): Promise<PriceObservation[]>;
}
```

Adapters:

- historical project BPU lines;
- sales quotes;
- approved/won BDC responses;
- supplier quotations;
- supplier invoices and purchase orders;
- current Moroccan web sources;
- published BDC/market award results where line-level or comparable totals exist.

#### `MoroccanWebPriceAdapter`

Uses a provider-neutral search port. The first implementation uses the [Brave Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get) (`BRAVE_SEARCH_API_KEY`) so the application receives structured result URLs without scraping a search-results page. Search results are not accepted as prices by themselves. The adapter fetches only approved Moroccan domains, extracts the product/service facts, and stores a dated snapshot hash.

Rules:

- domain must be active in the managed allowlist;
- price, currency, unit/package, HT/TTC status, and observation date must be recoverable;
- snippets without a verifiable landing page are rejected;
- stale observations are down-weighted, not silently treated as current;
- results are cached by normalized query and source URL;
- absence of a configured search provider degrades to internal and parametric estimation instead of failing the whole run.

#### `PriceNormalizer`

Converts observations into comparable MAD HT unit prices:

- canonical unit and package conversion;
- quantity/coverage conversion (for example litre-to-m² only with declared coverage);
- TTC-to-HT conversion using the observation's tax rate;
- transport, delivery, installation, warranty, waste, and packaging adjustments;
- region and execution-location adjustment;
- time/freshness adjustment using a versioned price index policy;
- rejection of dimensionally incompatible evidence.

Conversions must be explicit and auditable. The LLM may identify a likely conversion but a deterministic converter must validate it.

#### Category estimators

All estimators return cost, price range, assumptions, and missing inputs.

**Works estimator**

- decomposes composite lines into materials, labor, equipment, transport, waste, and site overhead;
- accounts for productivity and execution location;
- supports forfait lines while retaining the cost breakdown;
- adds a risk contingency for uncertain quantities or specifications.

**Supplies estimator**

- uses purchase price, package quantity, delivery, installation, warranty, import/availability risk, and required equivalents;
- distinguishes branded exact matches from compatible alternatives;
- rejects a cheaper product that fails a mandatory specification.

**Services estimator**

- estimates role-days or role-hours, seniority, travel, tools/licenses, deliverables, overhead, and contingency;
- distinguishes fixed-scope services from time-and-material services;
- derives a unit rate only after the effort model is complete.

#### `PriceDecisionEngine`

For each line:

1. score evidence by semantic fit, unit compatibility, source reliability, verification, freshness, geography, and specification coverage;
2. remove incompatible candidates and robust statistical outliers;
3. calculate a weighted median and uncertainty range;
4. combine evidence with the relevant category cost model;
5. apply the 15% cost markup floor;
6. assign provenance and confidence;
7. preserve any manual price.

Confidence levels:

- **high:** multiple recent compatible verified observations or an exact approved internal reference;
- **medium:** one strong observation plus a coherent parametric decomposition, or several weaker consistent observations;
- **low:** parametric/LLM-assisted fallback with sparse market evidence.

Every parseable line receives a provisional value. A line remains unpriced only if its quantity/unit/specification is structurally invalid; the run then exposes the exact blocking field.

#### `OfferOptimizer`

Builds a coherent total without destroying line economics.

1. Calculate every line's cost floor.
2. Derive a competitive target from comparable awards and approved company history when sufficient evidence exists.
3. If an administrative estimate exists, constrain the advisory target to its category corridor.
4. Allocate available commercial margin across lines while preserving every line's floor.
5. Flag line-level imbalance, excessive concentration, or impossible constraints.

If mixed categories occur in one BDC, each line uses its category estimator; total-level safeguards use the BDC's principal category and also report category subtotals.

## 6. Data Model

### `bdc.pricing_run`

- `id`, `avis_id`, `status`, `stage`, `progress_pct`
- `policy_version`, `model`, `started_at`, `finished_at`
- `administrative_estimate_ht`, `principal_category`
- `summary`, `warnings`, `error`
- `created_by`

### `bdc.pricing_line_decision`

- `run_id`, `line_idx`
- normalized analysis and decomposition
- `estimated_cost_ht`, `proposed_unit_price_ht`, range low/high
- markup, confidence, method, warnings
- source IDs and decision explanation
- `manual_price_locked`

### `bdc.price_observation`

- normalized designation, taxonomy, canonical unit
- observed unit price MAD HT
- region, observed date, freshness-adjusted date
- source type, source reference, source URL, snapshot hash
- verification state and reliability score
- structured metadata for package, brand, tax, transport, and conversion

Duplicate observations are prevented with a content/evidence hash.

### `bdc.pricing_feedback`

- run and line reference
- event: approved, manually corrected, submitted, won, lost, invoiced, actual cost recorded
- proposed, approved, actual, and winning prices when known
- correction reason and actor
- timestamp

## 7. Learning Loop

The system learns through retrieval and calibration, not uncontrolled foundation-model fine-tuning.

### Trusted learning events

- human-approved draft prices;
- supplier quotations validated by a user;
- supplier invoices and actual execution costs;
- submitted offers;
- award/loss results and published winning amounts.

Unapproved agent proposals never become training truth.

### Recalibration job

A scheduled worker job and an event-driven refresh:

- recompute source reliability from error against actual/approved costs;
- learn category, unit, supplier, region, and seasonal adjustment factors;
- decay stale evidence weights;
- update competitive-discount distributions only from comparable award data;
- compute MAPE, coverage, realized markup, and win-rate dashboards;
- publish a new immutable calibration version only when minimum sample sizes and replay tests pass.

At least 20 verified comparable observations are required before a learned segment factor replaces the global fallback. Smaller samples may inform confidence but not silently change the pricing policy.

### Corrections

A manual correction becomes a candidate lesson immediately, but receives full weight only after approval or confirmation by invoice/actual cost. Win/loss alone does not rewrite a line cost unless a comparable winning amount or verified cost is available.

## 8. API and UI

### API

- `POST /bdc/avis/:id/pricing-runs` — queue a new draft run; idempotency key required.
- `GET /bdc/avis/:id/pricing-runs/latest` — progress and latest decisions.
- `GET /bdc/pricing-runs/:runId` — complete audit payload.
- `POST /bdc/pricing-runs/:runId/cancel` — cancel a queued/active run.
- `POST /bdc/pricing-runs/:runId/apply` — apply only zero-priced lines to the draft response.
- `POST /bdc/pricing-runs/:runId/feedback` — record approval/correction/outcome evidence.

Only `marches`, `direction`, and `admin-si` roles may create, apply, or provide feedback. Reads follow the existing BDC authorization model.

### UI

The current button becomes **Chiffrer par l'agent** and displays live stages. The pricing table gains:

- proposed price and market range;
- base cost and markup;
- confidence badge;
- method and source count;
- an evidence drawer with links, dates, unit conversions, and assumptions;
- non-viable and regulatory warnings;
- an explicit **Appliquer au brouillon** action.

Manual prices remain locked. Applying a run never changes response status from `brouillon`.

## 9. Failure and Degradation Behavior

- Search provider unavailable: continue with internal and parametric evidence; reduce confidence.
- LLM unavailable: deterministic parsing and exact/semantic retrieval continue; composite lines may fall back to low confidence.
- One source fails: isolate the adapter and continue other sources.
- No direct evidence: category cost decomposition creates a provisional low-confidence price.
- Invalid quantity/unit: do not fabricate; return an actionable blocking warning.
- Estimate conflict: preserve the profitability floor and mark the offer non-viable.
- Worker restart: BullMQ retry is idempotent and resumes from persisted run state.
- Repeated run: content/idempotency hash reuses fresh evidence and prevents duplicate draft mutations.

## 10. Security and Audit

- Strict URL allowlist, HTTPS only, DNS resolution checks, private/link-local IP rejection, redirect revalidation, response-size limits, and timeouts prevent SSRF.
- External HTML is sanitized and parsed as untrusted data; prompt instructions in source pages are discarded.
- Search/fetch budgets per run prevent unbounded spend and crawling.
- Secrets remain server-side and are never included in evidence payloads.
- Every external price retains source URL, observation time, extraction method, and snapshot hash.
- Every run stores model, policy/calibration version, inputs, outputs, warnings, and actor.
- No automatic submission, supplier contact, purchase, or status transition is permitted.

## 11. Testing Strategy

### Domain tests

- unit and package conversions;
- HT/TTC normalization;
- freshness and regional adjustment;
- evidence compatibility and outlier rejection;
- minimum 15% markup invariant;
- category estimate corridors;
- allocation without violating line cost floors;
- manual price preservation;
- mixed-category BDC behavior.

### Estimator tests

- works fixture: building repair/renovation, including the screenshot's fissures, joints, tile removal, and painting lines;
- supplies fixture: exact specification, package conversion, delivery, warranty, and equivalent products;
- services fixture: multi-role effort, travel, tools, and fixed deliverables;
- composite and forfait lines;
- low-evidence fallback.

### Integration tests

- fake LLM structured analysis;
- fake web search and allowlisted fetches;
- repository evidence aggregation;
- BullMQ lifecycle, retries, cancellation, and idempotency;
- API authorization and draft-only application;
- learning event ingestion and calibration replay.

### End-to-end tests

- start a pricing run from a BDC page;
- observe progress;
- inspect evidence;
- apply the draft;
- verify every parseable zero line is priced;
- verify manual prices are unchanged;
- verify export uses the applied draft.

### Backtest

Run in shadow mode over historical BDCs with known approved/actual prices. Compare against the current lexical matcher on coverage, MAPE, profitable-price violations, and audit completeness. A calibration version is promoted only if replay does not regress protected invariants.

## 12. Implementation Sequence

The sequence does not reduce final scope; all three categories are required for completion.

1. Persisted evidence, run, decision, and feedback model.
2. Normalization and deterministic decision engine.
3. Works, supplies, and services estimators.
4. Internal evidence adapters.
5. Safe Moroccan web research adapter and source management.
6. Structured LLM analyzer and fallback.
7. BullMQ orchestration and APIs.
8. UI progress, evidence, warnings, and draft application.
9. Verified-feedback ingestion and versioned calibration.
10. Backtest, security review, production shadow run, then draft-mode activation.

## 13. Acceptance Criteria

The feature is complete only when all of the following are proven:

1. Works, supplies, and services fixtures are analyzed by their respective estimator.
2. Every parseable zero-priced line receives a proposed value or an explicit structurally-invalid blocker.
3. No manual price is overwritten.
4. Every proposal has method, cost basis, source trail, date/freshness, range, confidence, and explanation.
5. No cost-based price falls below the 15% markup floor.
6. Known administrative estimates produce the correct category warning/corridor behavior.
7. A current allowlisted Moroccan source can be researched end to end and audited from the UI.
8. Search, source, and LLM failures degrade without losing completed evidence or corrupting the draft.
9. Applying a run saves a draft and never submits or marks it ready automatically.
10. Approved feedback, actual costs, and award outcomes update a new calibration version; unapproved predictions do not.
11. Historical replay proves protected invariants and reports coverage/MAPE against the old matcher.
12. Production field verification proves queue execution, health, source audit, line application, and export on a real BDC from each category.
