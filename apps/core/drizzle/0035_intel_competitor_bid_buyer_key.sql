-- Buyer-scoped bid identity. Portal references (e.g. "05/2026") are reused across
-- 654 distinct acheteurs, so the old UNIQUE(reference, competitor_id) MERGED bids
-- from DIFFERENT buyers that happened to share a generic reference into ONE row —
-- clobbering amount_mad, sticky-OR'ing is_winner, overwriting buyer_name — which
-- permanently corrupted the winner/amount attribution.
--
-- Fix: add a buyer_key GENERATED column (lower + non-alnum→space + collapse,
-- accent-preserving — the immutable SQL twin of buyerIdentityKey() in
-- intel.repository.ts) and re-key the unique index on (reference, buyer_key,
-- competitor_id). Because every row derives buyer_key from the SAME expression,
-- existing rows, fresh inserts and re-harvests all fold identically, so the
-- ON CONFLICT upsert lands on the right row instead of duplicating it.
--
-- The new key is a strict SUPERSET of the old one (same columns + buyer_key), so
-- any set of rows already unique on (reference, competitor_id) stays unique on the
-- triple — adding it can NEVER violate on existing data, hence no de-dup DELETE
-- (unlike 0014). Already-merged rows remain lossy until the results/PV crawlers
-- re-harvest the correct per-buyer rows.
--
-- Hand-authored (drizzle-kit generate is blocked by the snapshot collision at 0026,
-- see 0034); applied by drizzle-kit migrate. Generated columns are Postgres 12+;
-- the lower/regexp_replace/btrim stack is IMMUTABLE, so it is legal both as a
-- generation expression and inside the unique index. IF [NOT] EXISTS keeps every
-- statement safe to re-run and safe against a manually-patched production box.
-- competitor_bid is ~4.5k rows, so the STORED column back-fill and the index
-- rebuild each run sub-second inside the migration transaction.
--> statement-breakpoint
ALTER TABLE "intel"."competitor_bid"
  ADD COLUMN IF NOT EXISTS "buyer_key" text
  GENERATED ALWAYS AS (btrim(regexp_replace(lower("buyer_name"), '[^a-z0-9à-ÿ]+', ' ', 'g'))) STORED;--> statement-breakpoint
DROP INDEX IF EXISTS "intel"."competitor_bid_reference_competitor_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competitor_bid_reference_buyer_competitor_uniq" ON "intel"."competitor_bid" USING btree ("reference","buyer_key","competitor_id");
