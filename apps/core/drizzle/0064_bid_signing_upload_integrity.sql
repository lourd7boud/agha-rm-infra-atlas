CREATE OR REPLACE FUNCTION "bid"."protect_signing_upload_outbox"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing upload outbox records are retained for audit';
  END IF;
  IF NEW."task_id" IS DISTINCT FROM OLD."task_id"
     OR NEW."package_file_id" IS DISTINCT FROM OLD."package_file_id"
     OR NEW."object_key" IS DISTINCT FROM OLD."object_key"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'signing upload target is immutable';
  END IF;
  IF NOT (
    NEW."state" = OLD."state"
    OR (OLD."state" = 'reserved' AND NEW."state" IN ('cleanup_pending','finalized','abandoned'))
    OR (OLD."state" = 'cleanup_pending' AND NEW."state" IN ('cleanup_pending','abandoned'))
    OR (OLD."state" = 'abandoned' AND NEW."state" = 'reserved')
  ) THEN
    RAISE EXCEPTION 'invalid signing upload state transition: % -> %', OLD."state", NEW."state";
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "bid_signing_upload_prevent_retarget"
  BEFORE UPDATE OR DELETE ON "bid"."signing_artifact_upload"
  FOR EACH ROW EXECUTE FUNCTION "bid"."protect_signing_upload_outbox"();
