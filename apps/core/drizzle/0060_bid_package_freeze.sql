ALTER TABLE "vault"."document"
  ADD COLUMN "filename" text,
  ADD COLUMN "size_bytes" integer,
  ADD CONSTRAINT "vault_document_size_check"
    CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0);

ALTER TABLE "bid"."package_version"
  ADD COLUMN "manifest" jsonb;

CREATE TABLE "bid"."package_requirement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "envelope" text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "source" text DEFAULT 'operator' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_package_requirement_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "bid"."workspace" ("id") ON DELETE RESTRICT,
  CONSTRAINT "bid_package_requirement_workspace_code_uniq" UNIQUE ("workspace_id", "code"),
  CONSTRAINT "bid_package_requirement_envelope_check"
    CHECK ("envelope" IN ('administrative','technical','financial','supplementary')),
  CONSTRAINT "bid_package_requirement_code_check"
    CHECK ("code" ~ '^[a-z0-9][a-z0-9_-]{1,79}$')
);

CREATE INDEX "bid_package_requirement_workspace_idx"
  ON "bid"."package_requirement" ("workspace_id");

ALTER TABLE "bid"."package_file"
  ADD COLUMN "requirement_id" uuid;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bid"."package_file" WHERE "requirement_id" IS NULL) THEN
    RAISE EXCEPTION 'cannot add mandatory requirement_id: existing package files require explicit migration';
  END IF;
END;
$$;

ALTER TABLE "bid"."package_file"
  ALTER COLUMN "requirement_id" SET NOT NULL,
  ADD CONSTRAINT "bid_package_file_requirement_fk"
    FOREIGN KEY ("requirement_id") REFERENCES "bid"."package_requirement" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "bid_package_file_requirement_uniq"
    UNIQUE ("package_version_id", "requirement_id");

ALTER TABLE "bid"."workspace"
  ADD CONSTRAINT "bid_workspace_current_package_fk"
  FOREIGN KEY ("id", "current_package_version")
  REFERENCES "bid"."package_version" ("workspace_id", "version");

ALTER TABLE "bid"."package_version"
  ADD CONSTRAINT "bid_package_freeze_fields_check"
  CHECK (
    ("status" = 'frozen' AND "manifest" IS NOT NULL AND "manifest_sha256" IS NOT NULL
      AND "frozen_by_sub" IS NOT NULL AND "frozen_at" IS NOT NULL)
    OR "status" <> 'frozen'
  );

CREATE OR REPLACE FUNCTION "bid"."protect_frozen_package_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" IN ('frozen', 'superseded') THEN
    RAISE EXCEPTION 'frozen bid package versions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "bid_package_version_immutable" ON "bid"."package_version";
CREATE TRIGGER "bid_package_version_immutable"
BEFORE UPDATE OR DELETE ON "bid"."package_version"
FOR EACH ROW
EXECUTE FUNCTION "bid"."protect_frozen_package_version"();

CREATE OR REPLACE FUNCTION "bid"."protect_frozen_package_file"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_id uuid;
  parent_status text;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."package_version_id" ELSE NEW."package_version_id" END;
  SELECT "status" INTO parent_status
  FROM "bid"."package_version"
  WHERE "id" = parent_id;
  IF parent_status IN ('frozen', 'superseded') THEN
    RAISE EXCEPTION 'files of a frozen bid package are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "bid_package_file_immutable" ON "bid"."package_file";
CREATE TRIGGER "bid_package_file_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "bid"."package_file"
FOR EACH ROW
EXECUTE FUNCTION "bid"."protect_frozen_package_file"();
