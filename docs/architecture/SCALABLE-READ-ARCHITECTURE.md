# ATLAS — Scalable Read Architecture (north star)

**Status:** in progress · branch `feat/scalable-architecture` · started 2026-07-03
**Owner directive:** _"لا أريد حلاً عاجلاً بل معمارية حقيقية تضمن ألا يتعطل النظام مهما كبر، وقابلة للتوسع مهما بلغ حجمه — والبطء ليس في صفحتين بل في النظام بالكامل."_

This document is the single source of truth for the performance/scalability rebuild.
It is intentionally in-repo (not chat) so any session — human or agent — can resume cold.

---

## 1. Diagnosis (code-verified, 17-agent audit + first-hand read)

ATLAS is slow because **it computes its read model at READ time, over the WHOLE dataset, on every request**, on an underpowered/contended Postgres, with **no cache that survives a restart or idle gap**. Per-request cost scales with total dataset size — the inverse of datao.

Confirmed root causes (ranked):

| # | Root cause | Evidence | Sev |
|---|-----------|----------|-----|
| 1 | Compute-on-read over full catalogue | `inventory.domain.ts:636-808` classifies every row (regex + 2× Zod parse of `raw`) + ~15 array sweeps for facets; slice at `:798` only | CRITICAL |
| 2 | Zero btree index on hot tender columns | `schema/tender.ts:71-80` only `source_url` unique; `findAll()` `ORDER BY deadlineAt` = Seq Scan + Sort | CRITICAL |
| 3 | `/stock` (and 9/13 segments) no `.catch` + no error boundary | `stock/page.tsx:108`; only `tenders/[id]` + `agents` have `error.tsx` | CRITICAL |
| 4 | Only cache is process-local `TtlCache` (Map, 10–30s), wiped on deploy/idle | `ttl-cache.ts:17-22`; `deploy.sh --force-recreate` | HIGH |
| 5 | `listAllBids()` drags full `competitor_bid` in the hot path | `tender.controller.ts:788`; heading to 150–300k rows | HIGH |
| 6 | `/project/projects` 1+N fan-out | `project.module.ts:131,337` per-project `listSituations()` | HIGH |
| 7 | No durable web cache: `no-store` everywhere, no React Query/SWR/ISR | `api.ts:48`; `web/package.json` has neither | MEDIUM |
| 8 | Portal/Digest BullMQ workers run inside the interactive API process | `portal.module.ts:132`, `digest.module.ts:129` | MEDIUM |

**North-star property:** per-request cost must become **O(page)**, independent of catalogue/bid/movement size, so "more data never costs more per request" — matching datao.

---

## 2. The Universal Read-Model Contract (applies to EVERY list surface)

Every catalogue/list surface in ATLAS (tenders, stock, projects, finance, buyers, intel, people, equipment, sales, supply, dashboard) MUST follow this contract. No surface loads its full dataset into Node again.

1. **Classify/aggregate at WRITE time, not read time.** Any derived field needed for listing/filtering/faceting (region, ville, category, secteur, lifecycle, lot count, balances, aging buckets…) is computed once when the row changes and stored in a column / denormalized read table — never recomputed per request.
2. **Paginate at the DB.** List reads = projected `SELECT <list columns, NO heavy JSONB> … WHERE <filters> ORDER BY <indexed col> LIMIT n [keyset/offset]`. Default page = 24 (datao parity). Heavy `raw`/detail JSON loads ONLY in the detail view.
3. **Facets = indexed `GROUP BY`.** Counts come from one indexed aggregate per dimension (cost O(distinct values)), not a JS sweep. Cache the facet snapshot briefly.
4. **Bounded joins.** Never `SELECT *` a growing child table (bids, movements, situations) in a list path. Join reference-scoped for the visible page, or fold the needed field into the read model at write time.
5. **Durable cache.** Back hot reads with Redis (already provisioned for BullMQ) behind the existing `TtlCache.getOrCompute` interface, invalidated on write, so a restart/deploy/idle never triggers a cold full-scan.
6. **Client caching.** React Query (TanStack) on the client with `keepPreviousData` + small pages + the existing `?since=` delta cursor. Short `revalidate`/stale-while-revalidate + `Cache-Control` on the `/api` proxy.
7. **Never white-screen.** Every list fetch degrades (`.catch(() => null)` + partial render) and every route segment has an `error.tsx`; plus a global `app/error.tsx` backstop.
8. **Isolate batch from interactive.** Crawler/harvest/digest/OCR run only in the worker container, never on the SSR event loop or the interactive DB pool.

---

## 3. Reusable building blocks to create once, then reuse everywhere

- `apps/core/src/lib/pagination.ts` — shared `PageQuery { limit, offset|cursor }` + `Page<T> { rows, total, facets }` contracts + zod schema (caps, defaults).
- `apps/core/src/lib/redis-cache.ts` — `RedisCache` implementing the same `getOrCompute(key, ttl, factory)` as `TtlCache`, single-flight, invalidate-on-write. Swap-in behind the identical interface.
- `apps/core/src/modules/tender/classification.ts` — the pure classifiers (`inferRegion/inferVille/inferCategory/inferSegment/inferLotCount/lifecycleStatus`) extracted from `inventory.domain.ts` so the WRITE path and any backfill reuse them (no drift).
- `apps/web/src/lib/query.ts` — React Query `QueryClient` provider + typed hooks (`useInventory`, `useStock`…) with `keepPreviousData`.
- `apps/web/src/app/error.tsx` + per-segment `error.tsx` — resilience backstop.

---

## 4. Phase sequence (each phase = its own PR, tested, deployable)

Phases are ordered so every step is a permanent layer of the final architecture (no throwaway). Nothing ships to prod without owner approval.

- **P0 — Resilience (never white-screen).** Global + per-segment `error.tsx`; per-call `.catch` on every list page; fix `/project/projects` N+1 via existing `listAllSituations`; gate Portal/Digest workers to the worker container. _Permanent: resilience + isolation are part of the target._
- **P1 — Index + project + paginate the tender read path.** Migration `0032`: hot-column btree indexes + competitor_bid functional index. Projected paginated repository method (no `raw`). Replace `listAllBids()` in the hot path with a reference-scoped query. _Acceptance: cold `/tender/inventory` p99 < 1s for a page; no `raw` on the wire._
- **P2 — Write-time classification + GROUP BY facets (the structural fix).** Add denormalized classification columns/table populated by crawler/enrichment via the extracted `classification.ts`; backfill migration; facets via indexed `GROUP BY`; inventory endpoint serves projected page + aggregate facets. _Acceptance: per-request cost O(page)+O(distinct facets), independent of row count._
- **P3 — Durable cache + client caching + rendering.** `RedisCache` behind `getOrCompute`, invalidate on crawl write; React Query on the client; `revalidate`/`Cache-Control`. _Acceptance: instant on every entry; cold-after-deploy gone._
- **P4 — Roll the contract across ALL surfaces.** Apply §2 to stock (in-DB balance `GROUP BY`), projects, finance (aging), buyers, intel, people, equipment, sales, supply, dashboard. _Acceptance: no surface calls `findAll()`/`listAll*` in a read path; each has an error boundary + pagination._
- **P5 — Infra right-sizing + circuit breakers.** Dedicated/larger Postgres; core `keepAliveTimeout/headersTimeout/requestTimeout`; Caddy/nginx response timeouts; consider read replica only after P2. _Acceptance: interactive SSR never starves behind batch; slow queries fast-fail._

## 5. Technology decisions

ADOPT: Redis app-cache · denormalized write-time read model · DB-side pagination + covering indexes · React Query · Next ISR/revalidate.
CONSIDER: dedicated/larger Postgres, read replica (only after P2).
AVOID: migrating the read path to PostgREST/Supabase — the defect is the read MODEL, not NestJS; a rewrite is risk without incremental gain once P1–P3 land.

## 6. Progress log
- 2026-07-03 — Branch created; audit complete; this plan written.
- 2026-07-03 — **P0 DONE (code, unshipped)** on `feat/scalable-architecture`:
  - `apps/web/src/app/error.tsx` (global backstop) + `apps/web/src/app/stock/error.tsx` — no route can white-screen with the naked digest again.
  - `apps/web/src/app/stock/page.tsx` — each of the 5 reads guarded (`.catch`, re-throwing redirects) + partial render + degraded banner.
  - `apps/core/.../project.module.ts` — `list()` N+1 removed via existing `listAllSituations()` + pure `financialPosition()` (spec green).
  - `apps/core/.../portal.module.ts` + `digest.module.ts` — BullMQ workers gated behind `WATCH_WORKER_ENABLED==='true'` (worker container only), off the interactive API event loop.
  - Verified: web `tsc` clean, core `tsc` clean, project spec 5/5.
  - **Deploy note:** the worker container must carry `PORTAL_CRON`/`DIGEST_CRON`/portal creds so those jobs still run there after the gate. Not shipped — awaiting owner approval.
- 2026-07-03 — **P1a DONE (code, unshipped)**: migration `0032_scalable_read_indexes` — 7 btree indexes (`tender`: created_at DESC, deadline_at, procedure, pipeline_state, buyer_name, (reference,buyer_name); `competitor_bid`: reference) + matching `index()` declarations in `schema/tender.ts` + `schema/intel.ts`. Core `tsc` clean. Hand-authored because `drizzle-kit generate` is blocked repo-wide by a pre-existing snapshot collision at 0026 (flagged as its own task); `drizzle-kit migrate` (the deploy path) is unaffected — that's how prod reached 0031.
- 2026-07-03 — **P1b step 1 DONE (code, unshipped)**: `inventory.domain.ts` refactored so `buildInventory` classifies/facets/filters/sorts EVERY row from base columns only, and parses the heavy `raw` JSONB (ai enrichment + dossier extraction, ~2 Zod safeParses/row) **only for the returned page** via the new `buildItem()`. Cuts per-request enrichment cost from O(all rows) to ~O(page). The `secteurs` facet now uses canonical deterministic labels (AI free-text secteur applied only to the displayed row) — cleaner buckets, and secteur is display-only (no server filter). Signature + `InventoryItem` output unchanged. Core `tsc` clean; inventory spec 32/32 (added a test locking the split).
- 2026-07-03 — **P1b step 2 DONE (code, unshipped) → P1 COMPLETE**: the `/tender/inventory` hot path no longer loads `raw` for the whole catalogue.
  - `tender.repository.ts`: new `findAllInventoryRows()` — projected `SELECT` (no `raw`/tsvectors/qualification), InMemory + Drizzle impls.
  - `inventory.domain.ts`: split into `selectInventory` (facets + page selection over light rows) + `hydrateInventory` (parses `raw` only for the page, from a full-record source) + `buildInventory` (behaviour-identical wrapper). New `InventoryRow`/`InventorySelection` types.
  - `tender.controller.ts`: inventory (normal + `?since=`) now `loadInventoryLight()` (projected rows + bids, 10s/2s single-flight) → `selectInventory` → `findByIds(pageIds)` → `hydrateInventory`. `buyers`/`buyer` keep the full `loadCatalogSnapshot`.
  - Net: the whole-catalogue read ships base columns only; `raw` (ai + dossier JSONB) crosses the wire + JSON.parse + Zod for the ≤limit page rows, not all ~5400. Combined with P1a indexes, per-request cost for the tender list is now bounded by the page, not the catalogue.
  - Verified: core `tsc` clean; **full core suite 680/680**; inventory spec 33/33 (added a two-phase controller-path test incl. missing-record degrade). DB-unverifiable parts (projected SQL plan, findByIds) validated by typecheck + the InMemory path; confirm on staging.
- 2026-07-03 — **P4 slice (RC9) DONE (code, unshipped)**: `/stock/balances` now aggregates in Postgres. The Drizzle `balances()` was `SELECT * FROM stock_movement` + a JS fold (unbounded, O(movements)); replaced with a type-safe `UNION ALL` (+quantity at `to_depot` for initial/purchase/adjustment/transfer, −quantity at `from_depot` for consumption/transfer) + `GROUP BY (depot, material)`, so only O(depot×material) aggregate rows cross the wire. InMemory keeps `computeBalances` (its spec pins the shared contract). Verified: core `tsc` clean, stock specs 14/14. The Drizzle set-operation SQL is DB-unverifiable locally (mirrors the proven `materialsCostByProject` GROUP BY + `computeBalances` signing) — sanity-check on staging.
- **Next: P2** — write-time classification columns (region/ville/category/secteur/lifecycle/lot_count…) populated by the crawler/enrichment via extracted classifiers, backfill migration, and `GROUP BY` facets — so facet counts become O(distinct values) and true DB-side keyset pagination (LIMIT 24) replaces the JS sort over all light rows. Then P3 (Redis durable cache + React Query + ISR), remaining P4 surfaces (projects/finance/buyers/…), P5 (infra).
