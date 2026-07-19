# BDC Autonomous Pricing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable, self-improving BDC pricing agent that prices works, supplies, and services from verified internal history and current Moroccan market evidence while preserving a 15% minimum cost markup and human draft approval.

**Architecture:** A BullMQ-backed `bdc-pricing` worker runs a seven-stage pipeline: structured line analysis, internal retrieval, allowlisted Moroccan web retrieval, normalization, category cost estimation, offer optimization, and draft persistence. Numeric decisions remain deterministic and versioned; the LLM interprets specifications and decomposes composite lines, while verified feedback recalibrates source and market weights without learning from unapproved predictions.

**Tech Stack:** NestJS 11, TypeScript 5.7, Drizzle ORM/PostgreSQL 16, BullMQ/Redis, Zod, existing `LlmClient`, Brave Web Search API, Next.js 15/React, Vitest.

## Global Constraints

- Final scope includes works, supplies, and services; none may be deferred from final acceptance.
- Cost-based proposals use a minimum markup of exactly 15% on cost unless a higher user-selected markup applies.
- Existing manual prices (`prixUnitaireHt > 0`) are immutable to the agent.
- Applying a run changes prices only; `bdc.reponse.statut` stays `brouillon`.
- External evidence must retain source URL, observation date, unit, tax basis, snapshot hash, and confidence.
- Internet retrieval uses Brave Search plus an explicit Moroccan-domain allowlist; snippets alone never become prices.
- Unapproved model output never becomes learning truth.
- The agent never submits a bid, contacts a supplier, purchases an item, or changes response status.
- All constructor dependencies use explicit `@Inject(...)`; this repository's runtime does not reliably emit implicit decorator metadata.
- Preserve the user's current accounting/sales work. Migration `0051_sales_doc_sequence.sql` is owned by that work; this feature starts at `0052` and edits `_journal.json` additively only.
- Every task uses RED → GREEN TDD and commits only the files listed by that task.

---

## File Map

### Core files to create

- `apps/core/src/modules/bdc/pricing/bdc-pricing.types.ts` — shared analysis, evidence, decision, run, feedback, and calibration contracts.
- `apps/core/src/modules/bdc/pricing/bdc-pricing.policy.ts` — markup and estimate-corridor policy.
- `apps/core/src/modules/bdc/pricing/bdc-price-normalizer.ts` — canonical units, HT/TTC, package, freshness, and region conversion.
- `apps/core/src/modules/bdc/pricing/bdc-works.estimator.ts` — works bottom-up estimator.
- `apps/core/src/modules/bdc/pricing/bdc-supplies.estimator.ts` — supplies landed-cost estimator.
- `apps/core/src/modules/bdc/pricing/bdc-services.estimator.ts` — services effort estimator.
- `apps/core/src/modules/bdc/pricing/bdc-price-decision.ts` — evidence scoring, outlier removal, confidence, line decision, and total optimizer.
- `apps/core/src/modules/bdc/pricing/bdc-pricing.repository.ts` — Drizzle persistence for runs, decisions, observations, feedback, and calibration.
- `apps/core/src/modules/bdc/pricing/bdc-internal-evidence.ts` — internal BPU/quote/BDC/supplier evidence adapter.
- `apps/core/src/modules/bdc/pricing/bdc-web-evidence.ts` — Brave search and SSRF-safe allowlisted page extraction.
- `apps/core/src/modules/bdc/pricing/bdc-line-analyzer.ts` — deterministic plus structured-LLM analysis.
- `apps/core/src/modules/bdc/pricing/bdc-pricing.service.ts` — seven-stage orchestration and idempotent draft application.
- `apps/core/src/modules/bdc/pricing/bdc-pricing.controller.ts` — run/status/apply/cancel/feedback endpoints.
- `apps/core/src/modules/bdc/pricing/bdc-pricing.worker.ts` — dedicated queue provider and worker lifecycle.
- `apps/core/src/modules/bdc/pricing/bdc-pricing-learning.ts` — verified feedback ingestion and versioned recalibration.
- `apps/core/src/modules/bdc/pricing/bdc-pricing-backtest.ts` — historical replay metrics.
- `apps/core/scripts/backtest-bdc-pricing.ts` — reproducible chronological backtest CLI and JSON report writer.
- Matching `*.spec.ts` files beside each domain/service file.

### Existing core files to modify

- `apps/core/src/db/schema/bdc.ts` — pricing tables.
- `apps/core/src/db/schema/index.ts` — export new tables if not already wildcard-exported.
- `apps/core/drizzle/0052_bdc_autonomous_pricing.sql` — additive migration.
- `apps/core/drizzle/meta/_journal.json` — append entry 52 without changing entry 51.
- `apps/core/src/modules/bdc/bdc.module.ts` — import `BrainModule`, add pricing providers/controller/worker.
- `apps/core/src/modules/bdc/bdc.repository.ts` — expose internal verified observations without changing legacy matching.
- `platform/.env.apps.example` — Brave, source allowlist, budgets, and learning schedule.

### Web files to modify/create

- `apps/web/src/lib/bdc.ts` — client-safe pricing contracts and new `agent` price source.
- `apps/web/src/app/tenders/bc/actions.ts` — create/apply/cancel/feedback server actions.
- `apps/web/src/app/tenders/bc/[id]/BdcPricer.tsx` — replace synchronous matcher UX with job progress and draft application.
- `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.tsx` — progress, confidence, warnings, and evidence drawer.
- `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.ts` — pure polling/action state reducer.
- `apps/web/src/app/api/bdc-pricing/[runId]/route.ts` — authenticated polling proxy if the client cannot call core directly.
- `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.spec.ts` — deterministic reducer and polling-transition tests.

---

### Task 1: Pricing contracts and protected policy

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.types.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.policy.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-pricing.policy.spec.ts`

**Interfaces:**

- Produces: `PricingCategory`, `NormalizedLine`, `PriceObservation`, `CostEstimate`, `LinePricingDecision`, `PricingRunView`, `PricingFeedbackInput`, `PricingCalibration`.
- Produces: `resolvePricingGuard(input): PricingGuard` and `applyMarkupFloor(costHt, requestedMarkupPct): number`.

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, test } from "vitest";
import { applyMarkupFloor, resolvePricingGuard } from "./bdc-pricing.policy";

describe("BDC pricing policy", () => {
  test("never applies less than 15 percent markup on cost", () => {
    expect(applyMarkupFloor(1_000, 0)).toBe(1_150);
    expect(applyMarkupFloor(1_000, 10)).toBe(1_150);
    expect(applyMarkupFloor(1_000, 20)).toBe(1_200);
  });

  test.each([
    ["travaux", 800_000, 1_200_000],
    ["fournitures", 750_000, 1_200_000],
    ["services", 750_000, 1_200_000],
  ] as const)("uses the category corridor for %s", (category, low, high) => {
    expect(
      resolvePricingGuard({ category, estimationHt: 1_000_000 }),
    ).toMatchObject({
      lowerHt: low,
      upperHt: high,
    });
  });

  test("does not claim a corridor when estimation is absent", () => {
    expect(
      resolvePricingGuard({ category: "travaux", estimationHt: null }),
    ).toEqual({
      lowerHt: null,
      upperHt: null,
      legalBasis: null,
    });
  });
});
```

- [ ] **Step 2: Run the test and prove RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.policy.spec.ts`
Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Define the exact contracts and policy**

Implement these discriminants and invariants:

```ts
export type PricingCategory = "travaux" | "fournitures" | "services";
export type PricingConfidence = "elevee" | "moyenne" | "faible";
export type PricingMethod =
  | "reference_directe"
  | "marche_pondere"
  | "decomposition"
  | "ia_conservative";
export type PricingRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type PricingStage =
  | "analyse"
  | "recherche_interne"
  | "recherche_marche"
  | "normalisation"
  | "estimation"
  | "optimisation"
  | "brouillon_enregistre";

export interface NormalizedLine {
  idx: number;
  category: PricingCategory;
  subcategory: string;
  designation: string;
  specification: string;
  quantity: number;
  unit: string;
  region: string | null;
  components: Array<{
    designation: string;
    quantityFactor: number;
    unit: string;
  }>;
  assumptions: string[];
  blockers: string[];
}

export interface PriceObservation {
  id?: string;
  designation: string;
  category: PricingCategory;
  unit: string;
  unitPriceHtMad: number;
  region: string | null;
  observedAt: string;
  sourceType:
    | "bpu"
    | "devis"
    | "bdc"
    | "fournisseur"
    | "facture"
    | "web"
    | "resultat";
  sourceRef: string;
  sourceUrl: string | null;
  snapshotHash: string;
  verified: boolean;
  reliability: number;
  metadata: Record<string, unknown>;
}

export interface CostEstimate {
  category: PricingCategory;
  unitCostHtMad: number;
  lowHtMad: number;
  highHtMad: number;
  assumptions: string[];
  components: Array<{ label: string; costHtMad: number; sourceIds: string[] }>;
}

export interface LinePricingDecision {
  idx: number;
  estimatedCostHt: number;
  proposedUnitPriceHt: number;
  rangeLowHt: number;
  rangeHighHt: number;
  markupPct: number;
  confidence: PricingConfidence;
  method: PricingMethod;
  sourceIds: string[];
  explanation: string;
  warnings: string[];
  manualPriceLocked: boolean;
}
```

`applyMarkupFloor` rounds MAD values to two decimals and uses `Math.max(15, requestedMarkupPct)`. `resolvePricingGuard` returns the exact corridors tested above and cites `decret-2-22-431-art-44` when an estimate exists.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.policy.spec.ts`
Expected: 3 policy cases PASS.
Run: `pnpm --filter @atlas/core typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-pricing.types.ts apps/core/src/modules/bdc/pricing/bdc-pricing.policy.ts apps/core/src/modules/bdc/pricing/bdc-pricing.policy.spec.ts
git commit -m "feat(bdc): define autonomous pricing policy"
```

### Task 2: Unit, tax, package, freshness, and region normalization

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-price-normalizer.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-price-normalizer.spec.ts`

**Interfaces:**

- Consumes: `PriceObservation`, `NormalizedLine`.
- Produces: `normalizeUnit(raw): CanonicalUnit`, `normalizeObservation(observation, line, policy): NormalizedObservation | null`.

- [ ] **Step 1: Add RED tests for safe conversions**

Test exact conversions: `m²/m2/M2 -> m2`, `ml/mètre linéaire -> ml`, `U/unité -> u`, `100 DH TTC at 20% -> 83.33 HT`, `10-pack at 600 DH -> 60 DH/u`, and rejection of `litre -> m2` without declared coverage. Add a freshness case where a two-year-old observation receives a lower weight than a 30-day observation, and a Casablanca-to-Agadir case using an explicit regional multiplier.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-price-normalizer.spec.ts`
Expected: FAIL because normalization functions do not exist.

- [ ] **Step 3: Implement deterministic normalization**

Use this public policy contract:

```ts
export interface NormalizationPolicy {
  now: Date;
  defaultTvaPct: number;
  annualInflationPct: number;
  regionMultipliers: Readonly<Record<string, number>>;
  maxAgeDays: number;
}

export interface NormalizedObservation extends PriceObservation {
  comparableUnitPriceHtMad: number;
  compatibility: number;
  freshness: number;
  conversionNotes: string[];
}
```

Only dimensionally exact conversions are automatic. Coverage-based conversions require numeric metadata (`coveragePerPackage` and `coverageUnit`). Return `null` for incompatible dimensions or observations older than `maxAgeDays` unless `verified === true`, in which case retain them with low freshness.

- [ ] **Step 4: Run GREEN and Task 1+2 regression**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.policy.spec.ts src/modules/bdc/pricing/bdc-price-normalizer.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-price-normalizer.ts apps/core/src/modules/bdc/pricing/bdc-price-normalizer.spec.ts
git commit -m "feat(bdc): normalize Moroccan pricing evidence"
```

### Task 3: Three category cost estimators

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-works.estimator.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-supplies.estimator.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-services.estimator.ts`
- Test: corresponding `*.spec.ts` files.

**Interfaces:**

- Consumes: `NormalizedLine`, `NormalizedObservation[]`.
- Produces: `estimateWorksCost`, `estimateSupplyCost`, and `estimateServiceCost`, each returning `CostEstimate`.

- [ ] **Step 1: Write one representative RED fixture per category**

Use these fixtures:

```ts
const worksLine = {
  idx: 0,
  category: "travaux",
  designation: "Reprise complète du joint",
  quantity: 10,
  unit: "ml",
  components: [
    { designation: "mortier de réparation", quantityFactor: 0.4, unit: "kg" },
    { designation: "main oeuvre maçon", quantityFactor: 0.2, unit: "h" },
  ],
};

const supplyLine = {
  idx: 0,
  category: "fournitures",
  designation: "Peinture ZENTIASTRAL 20 kg ou équivalent",
  quantity: 5,
  unit: "u",
};

const serviceLine = {
  idx: 0,
  category: "services",
  designation: "Audit technique avec rapport et déplacement Agadir",
  quantity: 1,
  unit: "forfait",
  components: [
    { designation: "ingénieur senior", quantityFactor: 2, unit: "jour" },
    { designation: "déplacement", quantityFactor: 1, unit: "forfait" },
  ],
};
```

Assert works includes material, labor, waste, and site overhead; supplies includes purchase, delivery, installation/warranty when specified; services includes role effort, travel, tools, overhead, and risk. Assert every component cost is non-negative and the total equals component sum.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-works.estimator.spec.ts src/modules/bdc/pricing/bdc-supplies.estimator.spec.ts src/modules/bdc/pricing/bdc-services.estimator.spec.ts`
Expected: three missing-module failures.

- [ ] **Step 3: Implement the estimators**

Each estimator uses compatible observations first and a versioned fallback rate card second. Rate cards are explicit data objects built from medians of verified internal observations; neither source code nor the LLM invents fixed market constants. If a segment has too little verified data, the analyzer may decompose the line and produce a conservative low-confidence cost assumption, but it must label that assumption and the 15% deterministic floor still applies. No estimator applies profit; it returns cost only.

The common helper is:

```ts
export function weightedMedian(
  values: Array<{ value: number; weight: number }>,
): number | null;
```

Works cost: material + labor + equipment + transport + waste + site overhead.
Supply cost: net purchase + delivery + installation + warranty/availability risk.
Service cost: role-days/hours + travel + tools/licenses + overhead + contingency.

- [ ] **Step 4: Run GREEN and coverage for all estimators**

Run: `pnpm --filter @atlas/core test:coverage -- src/modules/bdc/pricing/bdc-works.estimator.spec.ts src/modules/bdc/pricing/bdc-supplies.estimator.spec.ts src/modules/bdc/pricing/bdc-services.estimator.spec.ts`
Expected: all category tests PASS and each estimator file has at least 80% line/branch coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-works.estimator.ts apps/core/src/modules/bdc/pricing/bdc-works.estimator.spec.ts apps/core/src/modules/bdc/pricing/bdc-supplies.estimator.ts apps/core/src/modules/bdc/pricing/bdc-supplies.estimator.spec.ts apps/core/src/modules/bdc/pricing/bdc-services.estimator.ts apps/core/src/modules/bdc/pricing/bdc-services.estimator.spec.ts
git commit -m "feat(bdc): estimate works supplies and services costs"
```

### Task 4: Evidence decision and offer optimization

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-price-decision.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-price-decision.spec.ts`

**Interfaces:**

- Consumes: analyzed line, normalized observations, category `CostEstimate`, requested markup, optional estimate, locked manual lines.
- Produces: `decideLinePrice(input): LinePricingDecision` and `optimizeOffer(input): OfferPricingDecision`.

- [ ] **Step 1: Write RED decision tests**

Cover:

- exact verified recent reference produces high confidence;
- incompatible unit is excluded;
- an extreme price is removed by median absolute deviation;
- sparse evidence falls back to decomposition with low confidence;
- proposed price never falls below `cost × 1.15`;
- manual price is returned unchanged with `manualPriceLocked: true`;
- works total is constrained to `0.80E..1.20E` when feasible;
- supplies/services total uses `0.75E..1.20E`;
- cost floor above `1.20E` returns `nonViable: true` without cutting margin;
- mixed-category subtotal warnings are retained.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-price-decision.spec.ts`
Expected: FAIL because the decision engine does not exist.

- [ ] **Step 3: Implement deterministic scoring and optimization**

Use the score:

```ts
score =
  semanticFit * 0.3 +
  unitCompatibility * 0.2 +
  sourceReliability * 0.15 +
  freshness * 0.15 +
  specificationCoverage * 0.1 +
  geographyFit * 0.05 +
  (verified ? 0.05 : 0);
```

Reject scores below `0.35`. Determine confidence from effective evidence count and score dispersion. The optimizer allocates target margin proportionally to cost while respecting every line floor. It never changes locked lines and returns a warning when locked lines make a corridor impossible.

- [ ] **Step 4: Run GREEN and all pricing-domain regression**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing`
Expected: all Tasks 1–4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-price-decision.ts apps/core/src/modules/bdc/pricing/bdc-price-decision.spec.ts
git commit -m "feat(bdc): decide auditable profitable offer prices"
```

### Task 5: Persistent run, evidence, feedback, and calibration model

**Files:**

- Modify: `apps/core/src/db/schema/bdc.ts`
- Modify: `apps/core/src/db/schema/index.ts`
- Create: `apps/core/drizzle/0052_bdc_autonomous_pricing.sql`
- Modify additively: `apps/core/drizzle/meta/_journal.json`
- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.repository.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-pricing.repository.spec.ts`

**Interfaces:**

- Produces token `BDC_PRICING_REPOSITORY` and interface `BdcPricingRepository`.
- Produces CRUD methods used by Tasks 6–10.

- [ ] **Step 1: Add RED in-memory repository contract tests**

Define and test this contract:

```ts
export interface BdcPricingRepository {
  createRun(input: CreatePricingRun): Promise<PricingRunRecord>;
  getRun(id: string): Promise<PricingRunRecord | null>;
  getLatestRun(avisId: string): Promise<PricingRunRecord | null>;
  updateRun(id: string, patch: PricingRunPatch): Promise<PricingRunRecord>;
  replaceDecisions(
    runId: string,
    decisions: LinePricingDecision[],
  ): Promise<void>;
  listDecisions(runId: string): Promise<LinePricingDecision[]>;
  upsertObservations(items: PriceObservation[]): Promise<PriceObservation[]>;
  findObservations(query: ObservationQuery): Promise<PriceObservation[]>;
  recordFeedback(input: PricingFeedbackInput): Promise<void>;
  listVerifiedFeedback(since: Date): Promise<PricingFeedbackRecord[]>;
  getActiveCalibration(): Promise<PricingCalibration>;
  publishCalibration(value: PricingCalibration): Promise<void>;
}
```

Assert idempotent observation hashes, latest run order, decision replacement transactionality, and that unapproved feedback is excluded from `listVerifiedFeedback`.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.repository.spec.ts`
Expected: missing repository/schema failure.

- [ ] **Step 3: Add schema and migration**

Create tables from design section 6:

- `bdc.pricing_run`
- `bdc.pricing_line_decision`
- `bdc.price_observation`
- `bdc.pricing_feedback`
- `bdc.pricing_calibration`

Use foreign keys to `bdc.avis` and `bdc.pricing_run`, unique `(run_id,line_idx)`, unique `evidence_hash`, and indexes on `(avis_id,created_at)`, `(category,unit,observed_at)`, feedback verification/date, and active calibration version. Migration SQL is additive and idempotent only through Drizzle's journal, not `IF NOT EXISTS` shortcuts.

Append exactly:

```json
{
  "idx": 52,
  "version": "7",
  "when": 1784510000000,
  "tag": "0052_bdc_autonomous_pricing",
  "breakpoints": true
}
```

after the existing entry 51.

- [ ] **Step 4: Implement Drizzle and in-memory repositories, then GREEN**

The production provider uses `getDb(DATABASE_URL)` and explicit `@Inject(BDC_PRICING_REPOSITORY)` consumers. JSON fields are validated at repository boundaries with Zod. Run:

`pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.repository.spec.ts`
Expected: repository contract PASS.
`pnpm --filter @atlas/core typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/db/schema/bdc.ts apps/core/src/db/schema/index.ts apps/core/drizzle/0052_bdc_autonomous_pricing.sql apps/core/drizzle/meta/_journal.json apps/core/src/modules/bdc/pricing/bdc-pricing.repository.ts apps/core/src/modules/bdc/pricing/bdc-pricing.repository.spec.ts
git commit -m "feat(bdc): persist pricing evidence and learning runs"
```

### Task 6: Internal evidence adapter

**Files:**

- Modify: `apps/core/src/modules/bdc/bdc.repository.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-internal-evidence.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-internal-evidence.spec.ts`

**Interfaces:**

- Produces: `PriceEvidenceAdapter.search(query): Promise<PriceObservation[]>`.
- Consumes verified BPU, sales quote, prior BDC response, supplier invoice/order, and award-result projections.

- [ ] **Step 1: Write RED aggregation tests**

Seed one row from each source and assert:

- zero/negative prices are rejected;
- current BDC is excluded;
- prior BDC response is learnable only when approved/submitted/won or explicitly validated;
- source date and source reference are preserved;
- duplicate evidence collapses by hash;
- queries are bounded and projected, not raw table scans.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-internal-evidence.spec.ts`
Expected: missing adapter failure.

- [ ] **Step 3: Implement projected queries and adapter**

Add `findInternalPriceEvidence(query)` to `BdcRepository`; do not reuse unbounded `collectPriceCandidates`. Query a maximum of 200 recent compatible rows per source and return source timestamps. Use SQL predicates for nonzero price and a normalized query token lane, then semantic rescoring in the adapter.

- [ ] **Step 4: Run GREEN and existing BDC regression**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc`
Expected: legacy 19+ BDC tests and new adapter tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/bdc.repository.ts apps/core/src/modules/bdc/pricing/bdc-internal-evidence.ts apps/core/src/modules/bdc/pricing/bdc-internal-evidence.spec.ts
git commit -m "feat(bdc): retrieve verified internal price evidence"
```

### Task 7: Safe current Moroccan web evidence

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-web-evidence.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-web-evidence.spec.ts`
- Modify: `platform/.env.apps.example`

**Interfaces:**

- Produces: `BraveSearchClient.search(query): Promise<SearchHit[]>`.
- Produces: `SafePricePageFetcher.fetch(url): Promise<FetchedPage>`.
- Implements: `PriceEvidenceAdapter` as `MoroccanWebPriceAdapter`.

- [ ] **Step 1: Write RED security and extraction tests**

With fake DNS/fetch/search dependencies, assert:

- only `https:` and allowlisted hosts are accepted;
- loopback, RFC1918, link-local, IPv6 local, credentialed URLs, nonstandard ports, and redirect escape are rejected;
- response body stops at 2 MB and timeout is 12 seconds;
- a search snippet without a fetched price is rejected;
- JSON-LD `Offer.price`, visible `DH/MAD` price, package unit, and HT/TTC basis are extracted;
- source URL, current observation timestamp, and SHA-256 snapshot hash are stored;
- failed sites do not fail the whole query.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-web-evidence.spec.ts`
Expected: missing web adapter failure.

- [ ] **Step 3: Implement Brave search and safe fetch**

Use:

```ts
GET https://api.search.brave.com/res/v1/web/search?q=<encoded>&count=10&country=MA&search_lang=fr
X-Subscription-Token: ${BRAVE_SEARCH_API_KEY}
Accept: application/json
```

Configuration:

```env
BRAVE_SEARCH_API_KEY=
BDC_PRICE_SOURCE_DOMAINS=bricoma.ma,marjane.ma,electroplanet.ma,jumia.ma
BDC_PRICE_SEARCH_MAX_QUERIES=20
BDC_PRICE_FETCH_MAX_PAGES=30
BDC_PRICE_FETCH_TIMEOUT_MS=12000
```

The default domains are discovery seeds, not automatic trust: the adapter still requires a verifiable landing-page price and compatible specification. Make DNS and fetch injectable so tests never use the network.

- [ ] **Step 4: Run GREEN, typecheck, and secret scan**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-web-evidence.spec.ts`
Expected: all extraction/security cases PASS.
Run: `pnpm --filter @atlas/core typecheck`
Expected: exit 0.
Run: `rg -n "BRAVE_SEARCH_API_KEY=.+" --glob '!*.example' .`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-web-evidence.ts apps/core/src/modules/bdc/pricing/bdc-web-evidence.spec.ts platform/.env.apps.example
git commit -m "feat(bdc): research allowlisted Moroccan market prices"
```

### Task 8: Structured line analyzer with deterministic fallback

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-line-analyzer.ts`
- Test: `apps/core/src/modules/bdc/pricing/bdc-line-analyzer.spec.ts`

**Interfaces:**

- Consumes: `BdcArticle`, BDC category/nature/location, optional `LlmClient`.
- Produces: `analyzeLines(input): Promise<NormalizedLine[]>`.

- [ ] **Step 1: Write RED analyzer tests**

Cover:

- deterministic category mapping from BDC category;
- mixed BDC where line semantics override principal category;
- screenshot fixtures: fissure opening, joint repair, tile removal, and waterproof interior paint;
- supplies brand/equivalent, package, capacity, and warranty extraction;
- services deliverables, role-days, travel, and forfait extraction;
- strict rejection of out-of-range LLM indices/quantities;
- malicious page-like instructions inside `caracteristiques` treated as plain data;
- no-LLM fallback still returns a parseable normalized line with assumptions.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-line-analyzer.spec.ts`
Expected: missing analyzer failure.

- [ ] **Step 3: Implement deterministic parser and one batched T3 completion**

The response schema must require exactly one object per input index with enum category, canonical unit, components, assumptions, and blockers. Validate with Zod, merge only valid fields into deterministic results, and cap a batch at 100 lines. If the LLM fails, return deterministic results and attach `analyse_ia_indisponible`.

- [ ] **Step 4: Run GREEN with fake LLM and no-network tests**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-line-analyzer.spec.ts`
Expected: all works/supplies/services and adversarial cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-line-analyzer.ts apps/core/src/modules/bdc/pricing/bdc-line-analyzer.spec.ts
git commit -m "feat(bdc): understand all purchase order line categories"
```

### Task 9: Pricing orchestration, queue, and API

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.service.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.controller.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing.worker.ts`
- Test: matching `*.spec.ts` files.
- Modify: `apps/core/src/modules/bdc/bdc.module.ts`

**Interfaces:**

- Produces API routes from design section 8.
- Produces queue `bdc-pricing`, separate from the existing `bdc` crawl queue.

- [ ] **Step 1: Write RED orchestration tests**

Assert exact stage order, persisted progress, per-adapter failure isolation, cancellation, idempotency-key reuse, retry safety, every parseable zero line decided, manual line locking, completed decision persistence, and failure persistence. Assert `applyRun` updates only zero lines and keeps `statut=brouillon`.

- [ ] **Step 2: Write RED controller/authorization tests**

Test `202` creation, latest/status reads, `409` apply before completion, `404` unknown run, `400` invalid feedback, and role decorators for `marches`, `direction`, `admin-si` on mutations.

- [ ] **Step 3: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.service.spec.ts src/modules/bdc/pricing/bdc-pricing.controller.spec.ts src/modules/bdc/pricing/bdc-pricing.worker.spec.ts`
Expected: missing service/controller/worker failures.

- [ ] **Step 4: Implement service and dedicated queue**

Worker dispatch is explicit:

```ts
new Worker(
  "bdc-pricing",
  async (job) => {
    if (job.name !== "price")
      throw new Error(`Unknown BDC pricing job: ${job.name}`);
    return pricing.run(job.data.runId);
  },
  { connection: redisConnection(), lockDuration: 20 * 60 * 1000 },
);
```

The API process creates the queue but no worker. The dedicated application worker creates the consumer only when `WATCH_WORKER_ENABLED === 'true'`. Import `BrainModule` into `BdcModule`; inject `LLM_CLIENT` optionally and all other dependencies explicitly.

- [ ] **Step 5: Run GREEN, BDC regression, and boot probe**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc`
Expected: all old and new BDC tests PASS.
Run: `pnpm --filter @atlas/core typecheck`
Expected: exit 0.
Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing.worker.spec.ts`
Expected: the spec creates the Nest testing module with both `bdc` and `bdc-pricing` queue providers and exits without `UnknownDependenciesException`.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-pricing.service.ts apps/core/src/modules/bdc/pricing/bdc-pricing.service.spec.ts apps/core/src/modules/bdc/pricing/bdc-pricing.controller.ts apps/core/src/modules/bdc/pricing/bdc-pricing.controller.spec.ts apps/core/src/modules/bdc/pricing/bdc-pricing.worker.ts apps/core/src/modules/bdc/pricing/bdc-pricing.worker.spec.ts apps/core/src/modules/bdc/bdc.module.ts
git commit -m "feat(bdc): orchestrate autonomous pricing runs"
```

### Task 10: Verified feedback and automatic calibration

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing-learning.ts`
- Create: `apps/core/src/modules/bdc/pricing/bdc-pricing-backtest.ts`
- Create: `apps/core/scripts/backtest-bdc-pricing.ts`
- Test: matching `*.spec.ts` files.
- Modify: `apps/core/src/modules/bdc/pricing/bdc-pricing.worker.ts`
- Modify: `platform/.env.apps.example`

**Interfaces:**

- Produces: `recalibrate(now): Promise<PricingCalibration>`.
- Produces: `runBacktest(cases, calibration): BacktestReport`.

- [ ] **Step 1: Write RED learning tests**

Assert:

- unapproved predictions have zero learning weight;
- approved correction has provisional weight;
- invoice/actual cost has highest weight;
- source reliability falls after repeated large actual-cost errors;
- stale evidence decays;
- fewer than 20 comparable verified observations cannot replace a global factor;
- a passing sample publishes a new immutable version;
- replay that violates the 15% floor or worsens protected coverage is rejected;
- win/loss without comparable winning amount cannot alter cost.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/core test -- src/modules/bdc/pricing/bdc-pricing-learning.spec.ts src/modules/bdc/pricing/bdc-pricing-backtest.spec.ts`
Expected: missing learning modules.

- [ ] **Step 3: Implement versioned calibration and scheduled job**

Calibration contains source reliability, category/region/unit multipliers, freshness half-life, sample counts, MAPE, coverage, realized markup, and win metrics. Publish only after invariant replay passes. Add queue job `learn` with default cron `30 2 * * *` and idempotency by calendar date.

Add:

```env
BDC_PRICING_LEARNING_CRON=30 2 * * *
BDC_PRICING_MIN_SEGMENT_SAMPLES=20
BDC_PRICING_MIN_MARKUP_PCT=15
```

- [ ] **Step 4: Run GREEN and pricing suite coverage**

Run: `pnpm --filter @atlas/core test:coverage -- src/modules/bdc/pricing`
Expected: all pricing tests PASS; domain/learning files meet 80% line and branch coverage.

Run: `pnpm --filter @atlas/core exec tsx scripts/backtest-bdc-pricing.ts --help`
Expected: exit 0 and print the required `--output` argument plus optional `--as-of` cutoff.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/bdc/pricing/bdc-pricing-learning.ts apps/core/src/modules/bdc/pricing/bdc-pricing-learning.spec.ts apps/core/src/modules/bdc/pricing/bdc-pricing-backtest.ts apps/core/src/modules/bdc/pricing/bdc-pricing-backtest.spec.ts apps/core/scripts/backtest-bdc-pricing.ts apps/core/src/modules/bdc/pricing/bdc-pricing.worker.ts platform/.env.apps.example
git commit -m "feat(bdc): learn from verified pricing outcomes"
```

### Task 11: Pricing-agent web experience

**Files:**

- Modify: `apps/web/src/lib/bdc.ts`
- Modify: `apps/web/src/app/tenders/bc/actions.ts`
- Modify: `apps/web/src/app/tenders/bc/[id]/BdcPricer.tsx`
- Create: `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.tsx`
- Create: `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.ts`
- Create: `apps/web/src/app/api/bdc-pricing/[runId]/route.ts`
- Test: `apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.spec.ts`.

**Interfaces:**

- Consumes API run/status/apply/cancel/feedback contracts.
- Produces a draft-only agent workflow and evidence audit UI.

- [ ] **Step 1: Add RED state/interaction tests**

Assert queued→running→completed stages, 2-second polling only while active, cleanup on unmount, apply disabled before completion, evidence drawer content, confidence labels, non-viable warning, manual lock display, cancel behavior, and retry after failed run.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @atlas/web test -- src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.spec.ts`
Expected: missing component/state reducer failure.

- [ ] **Step 3: Extend client contracts and actions**

Add `agent` to `PrixSource`. Mirror `PricingRunView`, `LinePricingDecision`, and evidence summaries in `apps/web/src/lib/bdc.ts`. Server actions call the new endpoints with 60-second API timeouts only for mutation acknowledgement; they never wait for the whole run.

- [ ] **Step 4: Implement panel and integrate pricer**

Replace the old button label with **⚡ Chiffrer par l’agent**. Render the seven stages, progress bar, per-line confidence/method/source count, evidence drawer links, markup/range, and warnings. `Appliquer au brouillon` calls apply, refreshes lines, and never changes status. Keep the legacy matcher unavailable from the primary button but preserve its endpoint for rollback.

- [ ] **Step 5: Run GREEN and web typecheck**

Run: `pnpm --filter @atlas/web test -- src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.spec.ts`
Expected: all state/interaction cases PASS.
Run: `pnpm --filter @atlas/web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/bdc.ts apps/web/src/app/tenders/bc/actions.ts apps/web/src/app/tenders/bc/[id]/BdcPricer.tsx apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.tsx apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.ts apps/web/src/app/tenders/bc/[id]/BdcPricingAgentPanel.state.spec.ts apps/web/src/app/api/bdc-pricing/[runId]/route.ts
git commit -m "feat(web): add auditable BDC pricing agent workflow"
```

### Task 12: Full verification, shadow backtest, security review, and production field test

**Files:**

- Create: `apps/core/src/modules/bdc/pricing/fixtures/works-09-2026.json`
- Create: `apps/core/src/modules/bdc/pricing/fixtures/supplies-sample.json`
- Create: `apps/core/src/modules/bdc/pricing/fixtures/services-sample.json`
- Create: `artifacts/bdc-pricing/backtest.json`
- Create: `docs/runbooks/bdc-pricing-agent.md`
- Modify only if tests expose defects: pricing files from Tasks 1–11.

**Interfaces:**

- Proves every acceptance criterion in the design document.

- [ ] **Step 1: Add three end-to-end fixture tests**

The works fixture reproduces the screenshot request, including its long painting specification. Supply and service fixtures contain exact units, quantities, location, and one locked manual line. Each test proves: all parseable zero lines priced, manual unchanged, source trail present, markup invariant, category estimator used, and draft status retained.

- [ ] **Step 2: Run full local verification**

Run:

```bash
pnpm --filter @atlas/core typecheck
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/core test -- src/modules/bdc
pnpm --filter @atlas/core test:coverage -- src/modules/bdc/pricing
```

Expected: all commands exit 0, no skipped pricing tests, and pricing domain/learning coverage ≥80%.

- [ ] **Step 3: Run security checks**

Review all external-input and URL code for SSRF, prompt injection, secret leakage, unbounded payloads, unsafe redirects, and authorization gaps. Rerun adversarial web/analyzer tests. Confirm `git diff --check` and that no real API key appears in tracked files.

- [ ] **Step 4: Run historical shadow replay**

Run: `pnpm --filter @atlas/core exec tsx scripts/backtest-bdc-pricing.ts --output ../../artifacts/bdc-pricing/backtest.json`
The command replays every BDC with an approved/actual price using chronological train/test separation. The JSON report must contain old matcher coverage, agent coverage, MAPE, profitable-floor violations, estimate-corridor warnings, confidence calibration, and evidence completeness. The new system must have zero markup-floor/manual-overwrite violations and must not regress coverage.

- [ ] **Step 5: Write operations runbook**

Document environment variables, migration, Brave key setup, source allowlist ownership, queue inspection, calibration rollback, disabling web research, disabling learning, data-retention policy, health/log queries, and full feature rollback.

- [ ] **Step 6: Commit verification assets**

```bash
git add apps/core/src/modules/bdc/pricing/fixtures artifacts/bdc-pricing/backtest.json docs/runbooks/bdc-pricing-agent.md
git commit -m "test(bdc): verify autonomous pricing across all categories"
```

- [ ] **Step 7: Deploy in the required order**

1. Push all commits from the local `master` branch: `git push origin master`.
2. Verify DNS still resolves to the expected production host: `Resolve-DnsName atlas.marocinfra.com`; stop if the address is not `185.197.249.181`.
3. Connect with `ssh root@185.197.249.181`, then edit `/opt/atlas/platform/.env.apps` to set `BRAVE_SEARCH_API_KEY` and the reviewed Moroccan source allowlist. Never print the key.
4. On the server run `/opt/atlas/platform/scripts/deploy.sh`; it pulls with `--ff-only`, builds core/worker/web without cache, runs migration `0052` before recreation, and waits for core health.
5. Run `cd /opt/atlas/platform && docker compose -f docker-compose.apps.yml ps` and require core, worker, and web to be healthy.
6. Run `curl -fsS https://atlas.marocinfra.com/api/health` and inspect `docker compose -f docker-compose.apps.yml logs --since=10m core worker web` for migration, dependency-injection, queue, or restart failures.

- [ ] **Step 8: Field-verify one real BDC per category**

For works, supplies, and services separately, prove:

- run transitions through all seven stages;
- current web evidence is visible with URL/date/unit where available;
- every parseable zero line receives a proposal;
- locked manual prices stay byte-identical;
- no proposal violates the 15% cost markup floor;
- estimate guard/warnings match category;
- apply writes only the draft;
- XLSX export contains applied prices;
- no worker failure, injection error, SSRF warning, or container restart occurs.

- [ ] **Step 9: Prove learning without self-training**

Record one approved correction or actual-cost fixture, run `learn`, and prove a new calibration version is published. Record an unapproved agent proposal and prove it does not change the version or weights.

- [ ] **Step 10: Final completion audit**

Map each of the 12 acceptance criteria in `docs/superpowers/specs/2026-07-20-bdc-autonomous-pricing-agent-design.md` to direct evidence: test name/output, backtest report, API payload, UI screenshot, database row, container state, or worker log. Do not call the feature complete while any item lacks evidence.
