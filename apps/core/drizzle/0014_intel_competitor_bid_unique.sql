-- De-duplicate first: the pre-index SELECT-then-INSERT path let the result
-- crawler and the PV harvest both miss the SELECT and both INSERT, leaving
-- duplicate (reference, competitor_id) rows. Keep the lowest id per group so the
-- unique index below can be created. competitor_id NULLs are never equal
-- (NULL = NULL is unknown), which matches the index's NULLs-distinct semantics,
-- so any NULL-competitor rows are left untouched.
DELETE FROM "intel"."competitor_bid" a
USING "intel"."competitor_bid" b
WHERE a.reference = b.reference
  AND a.competitor_id = b.competitor_id
  AND a.id > b.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_bid_reference_competitor_uniq" ON "intel"."competitor_bid" USING btree ("reference","competitor_id");