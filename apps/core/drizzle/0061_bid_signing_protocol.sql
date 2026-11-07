ALTER TABLE "bid"."package_requirement"
  ADD COLUMN IF NOT EXISTS "requires_signature" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid"."signing_task" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "package_version_id" uuid NOT NULL,
  "manifest_sha256" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "signer_sub" text NOT NULL,
  "requested_by_sub" text NOT NULL,
  "requested_by_name" text NOT NULL,
  "pairing_secret_sha256" text,
  "pairing_expires_at" timestamp with time zone,
  "claimed_by_device_id" text,
  "claimed_by_device_name" text,
  "claimed_at" timestamp with time zone,
  "lease_secret_sha256" text,
  "lease_expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_signing_task_state_check"
    CHECK ("state" IN ('pending','claimed','completed','failed','cancelled')),
  CONSTRAINT "bid_signing_task_manifest_hash_check"
    CHECK ("manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_signing_task_pairing_hash_check"
    CHECK ("pairing_secret_sha256" IS NULL OR "pairing_secret_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_signing_task_lease_hash_check"
    CHECK ("lease_secret_sha256" IS NULL OR "lease_secret_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_signing_task_secret_state_check" CHECK (
    ("state" = 'pending' AND "pairing_secret_sha256" IS NOT NULL AND "pairing_expires_at" IS NOT NULL AND "lease_secret_sha256" IS NULL)
    OR ("state" = 'claimed' AND "pairing_secret_sha256" IS NULL AND "claimed_by_device_id" IS NOT NULL AND "claimed_at" IS NOT NULL AND "lease_secret_sha256" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR "state" IN ('completed','failed','cancelled')
  )
);
--> statement-breakpoint

ALTER TABLE "bid"."signing_task"
  ADD CONSTRAINT "bid_signing_task_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "bid"."workspace"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "bid"."signing_task"
  ADD CONSTRAINT "bid_signing_task_package_fk"
  FOREIGN KEY ("package_version_id") REFERENCES "bid"."package_version"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_signing_task_workspace_idx"
  ON "bid"."signing_task" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bid_signing_task_active_workspace_uniq"
  ON "bid"."signing_task" ("workspace_id")
  WHERE "state" IN ('pending','claimed');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid"."signing_artifact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "package_file_id" uuid NOT NULL,
  "bucket" text NOT NULL,
  "object_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "certificate_thumbprint" text NOT NULL,
  "certificate_subject" text NOT NULL,
  "signed_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_signing_artifact_task_file_uniq" UNIQUE ("task_id", "package_file_id"),
  CONSTRAINT "bid_signing_artifact_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "bid_signing_artifact_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "bid"."signing_artifact"
  ADD CONSTRAINT "bid_signing_artifact_task_fk"
  FOREIGN KEY ("task_id") REFERENCES "bid"."signing_task"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "bid"."signing_artifact"
  ADD CONSTRAINT "bid_signing_artifact_package_file_fk"
  FOREIGN KEY ("package_file_id") REFERENCES "bid"."package_file"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bid"."validate_signing_task_target"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workspace_row "bid"."workspace"%ROWTYPE;
  package_row "bid"."package_version"%ROWTYPE;
BEGIN
  SELECT * INTO workspace_row FROM "bid"."workspace"
  WHERE "id" = NEW."workspace_id" FOR UPDATE;
  SELECT * INTO package_row FROM "bid"."package_version"
  WHERE "id" = NEW."package_version_id";

  IF workspace_row."state" <> 'frozen' THEN
    RAISE EXCEPTION 'signing task requires frozen workspace';
  END IF;
  IF package_row."workspace_id" <> NEW."workspace_id"
     OR package_row."status" <> 'frozen'
     OR package_row."version" <> workspace_row."current_package_version"
     OR package_row."manifest_sha256" <> NEW."manifest_sha256" THEN
    RAISE EXCEPTION 'signing task package/manifest mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "bid"."package_requirement" requirement
    JOIN "bid"."package_file" file
      ON file."requirement_id" = requirement."id"
     AND file."package_version_id" = NEW."package_version_id"
    WHERE requirement."workspace_id" = NEW."workspace_id"
      AND requirement."requires_signature" = true
  ) THEN
    RAISE EXCEPTION 'signing task has no operator-confirmed files';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "bid_signing_task_validate_target"
  BEFORE INSERT ON "bid"."signing_task"
  FOR EACH ROW EXECUTE FUNCTION "bid"."validate_signing_task_target"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bid"."prevent_signing_task_retarget"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."workspace_id" <> OLD."workspace_id"
     OR NEW."package_version_id" <> OLD."package_version_id"
     OR NEW."manifest_sha256" <> OLD."manifest_sha256"
     OR NEW."signer_sub" <> OLD."signer_sub"
     OR NEW."requested_by_sub" <> OLD."requested_by_sub" THEN
    RAISE EXCEPTION 'signing task target is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "bid_signing_task_prevent_retarget"
  BEFORE UPDATE ON "bid"."signing_task"
  FOR EACH ROW EXECUTE FUNCTION "bid"."prevent_signing_task_retarget"();
