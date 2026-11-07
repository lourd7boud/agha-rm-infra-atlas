CREATE OR REPLACE FUNCTION "bid"."validate_signing_artifact_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "bid"."signing_task" task
    JOIN "bid"."package_file" file
      ON file."id" = NEW."package_file_id"
     AND file."package_version_id" = task."package_version_id"
    JOIN "bid"."package_requirement" requirement
      ON requirement."id" = file."requirement_id"
     AND requirement."workspace_id" = task."workspace_id"
    WHERE task."id" = NEW."task_id"
      AND task."state" = 'claimed'
      AND requirement."requires_signature" IS TRUE
  ) THEN
    RAISE EXCEPTION 'signing artifact is outside the task signature scope';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "bid_signing_artifact_validate_scope"
  ON "bid"."signing_artifact";
CREATE TRIGGER "bid_signing_artifact_validate_scope"
  BEFORE INSERT ON "bid"."signing_artifact"
  FOR EACH ROW EXECUTE FUNCTION "bid"."validate_signing_artifact_scope"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bid"."prevent_signing_artifact_retarget"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing artifact evidence is immutable';
  END IF;
  IF NEW."task_id" IS DISTINCT FROM OLD."task_id"
     OR NEW."package_file_id" IS DISTINCT FROM OLD."package_file_id"
     OR NEW."bucket" IS DISTINCT FROM OLD."bucket"
     OR NEW."object_key" IS DISTINCT FROM OLD."object_key"
     OR NEW."filename" IS DISTINCT FROM OLD."filename"
     OR NEW."mime" IS DISTINCT FROM OLD."mime"
     OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."certificate_thumbprint" IS DISTINCT FROM OLD."certificate_thumbprint"
     OR NEW."certificate_subject" IS DISTINCT FROM OLD."certificate_subject"
     OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR (OLD."verified_at" IS NOT NULL AND NEW."verified_at" IS DISTINCT FROM OLD."verified_at")
     OR (OLD."verified_at" IS NULL AND NEW."verified_at" IS NULL) THEN
    RAISE EXCEPTION 'signing artifact evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "bid_signing_artifact_prevent_retarget"
  ON "bid"."signing_artifact";
CREATE TRIGGER "bid_signing_artifact_prevent_retarget"
  BEFORE UPDATE OR DELETE ON "bid"."signing_artifact"
  FOR EACH ROW EXECUTE FUNCTION "bid"."prevent_signing_artifact_retarget"();
