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
- 2026-07-03 — **DEPLOYED to production (commit `7c30d90`) + field-verified.** `git push origin master` (099e957→7c30d90) then `deploy.sh` on the VPS: migration 0032 applied ("migrations applied successfully"), all 3 images rebuilt, core/worker/web healthy, `/api/health` ok, `deployed 7c30d90 OK`. Verified directly on prod DB/logs: all 6 new tender btree indexes + `competitor_bid_reference_idx` present; the stock balances `UNION`/`GROUP BY` executes cleanly (0 rows — no movements yet); **worker isolation CONFIRMED** — core logs "Portal/Sentinel/Digest worker DISABLED — API-only", worker logs "Portal harvest scheduled 0 7 * * *" + "Sentinel continuous" + "Morning brief scheduled 30 7 * * *" + a live `tender.detected`. Catalogue now 5969 tenders. No errors in core logs. Rollback: `git reset --hard 099e957 && platform/scripts/deploy.sh`. UI (/tenders, /stock) pending owner browser confirmation (Keycloak-gated).
- 2026-07-03 — **LIGHT LIST shipped (commit `ba9b9dd`) + BROWSER-VERIFIED LIVE.** Field verification found the real bottleneck: core is single-threaded and each `/tender/inventory` did O(catalogue) CPU (classify 5969 + ~10k Zod parses + 14MB `JSON.stringify`), blocking the event loop — isolated ~3s but under concurrency it compounded to **158s** → 15s web timeout → the panel. Fix: the list is now LIGHT — `findAllInventoryRows()` SQL-projects the light-enrichment flags/strings (`hasBpu`/`bpuCount`/`aiResume`/`aiSecteur`/`aiEnrichedAt`/`budgetFromDossier` via jsonb `->>`/array-length), `buildLightItem()` builds items with ZERO Zod parse and omits the heavy dossier arrays, and `assembleInventory()` builds directly from the projected page (no `findByIds`, no raw hydration). The detail drawer fetches `GET /tender/tenders/:id` on open (new proxy `/api/tender/tenders/[id]`) + merges full enrichment; the bpu-only filter uses `hasBpu`; `tenders/page.tsx` re-throws auth redirects (expired session → /login, not the panel). **Measured on prod: payload 14MB→6.4MB; 5 concurrent heavy reqs 158s→~1.7s.** Browser-verified with a fresh dg login: `/tenders` renders 5983 tenders + facets + the drawer loads full detail (résumé + DCE conditions); `/stock` renders the 156-material catalogue (no white-screen).
  - **Known remaining (cause intermittent core CPU spikes, NOT the primary failure):** (a) `/agents` `coverage` query full-scans `watch.portal_snapshot` (huge raw-HTML rows) → 30s statement timeout → ~180s, spiking core CPU (`agents.module.ts:196` → `snapshot.repository.ts:102`); (b) `WATCH_CONTINUOUS=true` adds baseline crawl load; (c) list payload still 6.4MB (aiResume) — droppable; (d) `buyers`/`knowledge`/`orchestrator` still do full-catalogue CPU.
- 2026-07-03 — **`/agents` coverage query FIXED (commit `28cc1f3`) + prod-verified.** `DrizzleSnapshotRepository.coverage()` replaced `SELECT * FROM watch.portal_snapshot` + JS fold with a per-source `GROUP BY` (count / count-filter(changed) / sum(items) / max()-filter for last fetch+change / `array_agg(... order by fetched_at desc)[1]` for last parseOk). Measured on prod: **`/agents` 180s → 4.4s**, and **core health `unhealthy` → `healthy`** — the last big event-loop-blocking full-scan is gone, removing the intermittent core-CPU spikes that made other pages (incl. /tenders SSR) occasionally time out. Core tsc + 115 watch/agents tests. InMemory + buildCoverage unchanged.
- 2026-07-03 — **`/buyers` observatory switched to light rows (no raw).** `buyers()`/`buyer()` now read `loadInventoryLight()` (projected, no raw) instead of `loadCatalogSnapshot()` — `buildBuyerProfiles` only needs base fields (the `BuyerObservationRow` Pick: buyerName/objet/procedure/estimation/deadline/state), so the observatory no longer drags the whole raw catalogue + blocks the event loop when opened. Core tsc + 10 buyer tests.
  - **Still full-raw (same pattern, fix next):** `GET /orchestrator` (dashboard Chef d'Orchestre — `findAll()`+`present`/checklist; needs checking whether `buildComplianceChecklist`/`nextActions` require `raw`/`qualification` before switching to light); `GET /tender/tenders` (deadline wall — loads all raw + `present` per row, but NOT called by the web, so low priority); the per-tender `competitor-intel` handler still loads the full snapshot for its `bids`.
- **Next: P2** — write-time classification columns (region/ville/category/secteur/lifecycle/lot_count…) populated by the crawler/enrichment via extracted classifiers, backfill migration, and `GROUP BY` facets — so facet counts become O(distinct values) and true DB-side keyset pagination (LIMIT 24) replaces the JS sort over all light rows. Then P3 (Redis durable cache + React Query + ISR), remaining P4 surfaces (projects/finance/…), P5 (infra). Also consider `WATCH_CONTINUOUS=false` (periodic crawl) to cut baseline core/DB load, and dropping `aiResume` from the list to shrink the 6.4MB payload further.
