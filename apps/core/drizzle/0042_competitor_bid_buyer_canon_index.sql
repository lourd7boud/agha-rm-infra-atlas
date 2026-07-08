-- Make the competitor-intel drawer's per-buyer bid read O(log n + matches) instead
-- of a whole-table seq-scan. `findBidsForBuyer` fetches ONE buyer's bids (the drawer
-- needs only that buyer's history) folded on the canonical, ACCENT-STRIPPING buyer key
-- — the same fold canonicalReferenceKey()/normalizeFr() use in TS, so an OCR'd notice
-- spelling "Prefecture" still matches the portal's "Préfecture". The existing
-- buyer_key generated column keeps accents (it backs the uniqueness key), so it cannot
-- serve this match; we need an accent-stripped functional index.
--
-- unaccent() is only STABLE (its result depends on the search_path-resolved
-- dictionary), so Postgres refuses it in an index expression / generated column. The
-- standard fix is a thin IMMUTABLE wrapper that PINS the dictionary by name and fixes
-- search_path — the dictionary file is static, so the fold is deterministic. This is
-- the documented Postgres idiom, mirrored by findBidsForBuyer's WHERE so the planner
-- matches this index (same function, same expression tree).
--
-- Hand-authored (drizzle-kit generate is blocked by the pre-existing 0026 snapshot
-- collision); applied by drizzle-kit migrate. Every statement is IF NOT EXISTS /
-- CREATE OR REPLACE, so the migration is safe to re-run. competitor_bid is ~550k rows
-- → the (non-concurrent) index build takes a few seconds under a brief write lock,
-- acceptable during a deploy window; it runs BEFORE the new code is recreated.
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "unaccent";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "intel"."immutable_unaccent"(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = public, pg_catalog
AS $func$ SELECT unaccent('unaccent', $1) $func$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_bid_buyer_canon_idx"
  ON "intel"."competitor_bid" USING btree (
    btrim(regexp_replace(lower("intel"."immutable_unaccent"("buyer_name")), '[^a-z0-9]+', ' ', 'g'))
  );
