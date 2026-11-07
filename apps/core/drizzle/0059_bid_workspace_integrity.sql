ALTER TABLE "bid"."workspace"
  DROP CONSTRAINT IF EXISTS "bid_workspace_official_receipt_fk";

ALTER TABLE "bid"."evidence"
  ADD CONSTRAINT "bid_evidence_workspace_id_uniq" UNIQUE ("workspace_id", "id");

ALTER TABLE "bid"."workspace"
  ADD CONSTRAINT "bid_workspace_official_receipt_same_workspace_fk"
  FOREIGN KEY ("id", "official_receipt_evidence_id")
  REFERENCES "bid"."evidence" ("workspace_id", "id");

ALTER TABLE "bid"."workspace"
  ADD CONSTRAINT "bid_workspace_receipt_pair_check"
  CHECK (
    ("official_receipt_evidence_id" IS NULL AND "submitted_at" IS NULL)
    OR
    ("official_receipt_evidence_id" IS NOT NULL AND "submitted_at" IS NOT NULL)
  );

ALTER TABLE "bid"."workspace"
  ADD CONSTRAINT "bid_workspace_submission_evidence_check"
  CHECK (
    "state" NOT IN (
      'submitted', 'withdrawal_pending', 'withdrawn', 'opened', 'won', 'lost',
      'rejected', 'guarantee_release_eligible', 'closed'
    )
    OR ("official_receipt_evidence_id" IS NOT NULL AND "submitted_at" IS NOT NULL)
  );

ALTER TABLE "bid"."event"
  DROP CONSTRAINT IF EXISTS "event_workspace_id_fkey";
ALTER TABLE "bid"."event"
  DROP CONSTRAINT IF EXISTS "event_workspace_id_workspace_id_fk";
ALTER TABLE "bid"."event"
  ADD CONSTRAINT "bid_event_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "bid"."workspace" ("id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "bid"."validate_official_receipt_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."official_receipt_evidence_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "bid"."evidence" AS evidence
    WHERE evidence."id" = NEW."official_receipt_evidence_id"
      AND evidence."workspace_id" = NEW."id"
      AND evidence."kind" = 'official_receipt'
      AND evidence."verified_at" IS NOT NULL
      AND evidence."verified_by_sub" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'workspace receipt must reference verified official_receipt evidence from the same workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bid_workspace_validate_official_receipt" ON "bid"."workspace";
CREATE TRIGGER "bid_workspace_validate_official_receipt"
BEFORE INSERT OR UPDATE OF "official_receipt_evidence_id", "submitted_at", "state"
ON "bid"."workspace"
FOR EACH ROW
EXECUTE FUNCTION "bid"."validate_official_receipt_link"();

CREATE OR REPLACE FUNCTION "bid"."protect_linked_official_receipt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bid"."workspace"
    WHERE "official_receipt_evidence_id" = OLD."id"
  ) AND (
    TG_OP = 'DELETE'
    OR NEW."kind" <> 'official_receipt'
    OR NEW."verified_at" IS NULL
    OR NEW."verified_by_sub" IS NULL
    OR NEW."workspace_id" <> OLD."workspace_id"
  ) THEN
    RAISE EXCEPTION 'linked official receipt evidence is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "bid_evidence_protect_linked_receipt" ON "bid"."evidence";
CREATE TRIGGER "bid_evidence_protect_linked_receipt"
BEFORE UPDATE OR DELETE ON "bid"."evidence"
FOR EACH ROW
EXECUTE FUNCTION "bid"."protect_linked_official_receipt"();
