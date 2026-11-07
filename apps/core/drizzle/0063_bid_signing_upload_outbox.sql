CREATE TABLE IF NOT EXISTS "bid"."signing_artifact_upload" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "package_file_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "sha256" text NOT NULL,
  "state" text DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "finalized_at" timestamp with time zone,
  "abandoned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_signing_upload_object_key_uniq" UNIQUE ("object_key"),
  CONSTRAINT "bid_signing_upload_state_check"
    CHECK ("state" IN ('reserved','cleanup_pending','finalized','abandoned')),
  CONSTRAINT "bid_signing_upload_sha256_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_signing_upload_task_fk"
    FOREIGN KEY ("task_id") REFERENCES "bid"."signing_task"("id") ON DELETE RESTRICT,
  CONSTRAINT "bid_signing_upload_file_fk"
    FOREIGN KEY ("package_file_id") REFERENCES "bid"."package_file"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_signing_upload_cleanup_idx"
  ON "bid"."signing_artifact_upload" ("state", "expires_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bid"."validate_signing_upload_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
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
    RAISE EXCEPTION 'signing upload reservation is outside the task scope';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "bid_signing_upload_validate_scope"
  BEFORE INSERT ON "bid"."signing_artifact_upload"
  FOR EACH ROW EXECUTE FUNCTION "bid"."validate_signing_upload_scope"();
