-- At most one décompte per (project_id, periode_id): the métré-driven décompte
-- upsert relies on it, and it blocks concurrent double-saves from creating
-- duplicate rows that would double-count in the cumulative "décomptes précédents".
-- First drop any pre-existing duplicates (keep the most recent), then add the
-- partial unique index (période-less manual décomptes remain allowed).
DELETE FROM "project"."decompte" d
USING "project"."decompte" k
WHERE d."periode_id" IS NOT NULL
  AND d."project_id" = k."project_id"
  AND d."periode_id" = k."periode_id"
  AND (
    d."created_at" < k."created_at"
    OR (d."created_at" = k."created_at" AND d."id" < k."id")
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decompte_project_periode_uq"
  ON "project"."decompte" ("project_id", "periode_id")
  WHERE "periode_id" IS NOT NULL;
