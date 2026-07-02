-- intel.knowledge_snapshot — the expert agent's precomputed knowledge base.
--
-- GET /expert/knowledge used to recompute everything inline (full tender
-- table incl. heavy raw jsonb → 504 behind nginx once cold). Now the worker
-- recomputes in the background and upserts this single row; the API serves
-- it in one indexed read — constant latency regardless of data volume.
--
-- Purely additive: one single-row table.
--> statement-breakpoint

CREATE TABLE "intel"."knowledge_snapshot" (
  "id" numeric(1, 0) PRIMARY KEY NOT NULL,
  "payload" text NOT NULL,
  "computed_at" timestamp with time zone NOT NULL
);
