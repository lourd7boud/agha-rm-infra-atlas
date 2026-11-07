CREATE SCHEMA IF NOT EXISTS "bid";

CREATE TABLE "bid"."workspace" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
  "tender_id" uuid NOT NULL REFERENCES "tender"."tender"("id"),
  "owner_sub" text NOT NULL,
  "owner_name" text NOT NULL,
  "signer_sub" text,
  "state" text DEFAULT 'evaluating' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "current_package_version" integer,
  "official_receipt_evidence_id" uuid,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_workspace_company_tender_uniq" UNIQUE("company_id","tender_id"),
  CONSTRAINT "bid_workspace_version_check" CHECK ("version" >= 0),
  CONSTRAINT "bid_workspace_state_check" CHECK ("state" IN ('evaluating','go','no_go','assembling','review','frozen','awaiting_signature','signing','signed','ready_to_submit','submitting','submitted','withdrawal_pending','withdrawn','opened','won','lost','rejected','cancelled','guarantee_release_eligible','closed'))
);

CREATE TABLE "bid"."event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "bid"."workspace"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "from_state" text,
  "to_state" text,
  "actor_sub" text NOT NULL,
  "actor_name" text NOT NULL,
  "reason" text,
  "metadata" jsonb,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_event_workspace_sequence_uniq" UNIQUE("workspace_id","sequence"),
  CONSTRAINT "bid_event_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "bid"."evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "bid"."workspace"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "bucket" text NOT NULL,
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "external_reference" text,
  "metadata" jsonb,
  "captured_by_sub" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_by_sub" text,
  "verified_at" timestamp with time zone,
  CONSTRAINT "bid_evidence_workspace_sha256_uniq" UNIQUE("workspace_id","sha256"),
  CONSTRAINT "bid_evidence_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "bid_evidence_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_evidence_kind_check" CHECK ("kind" IN ('official_receipt','signed_package','portal_confirmation','portal_screenshot','result_notice','guarantee_release_receipt'))
);

CREATE TABLE "bid"."package_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "bid"."workspace"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "manifest_sha256" text,
  "created_by_sub" text NOT NULL,
  "frozen_by_sub" text,
  "frozen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_package_workspace_version_uniq" UNIQUE("workspace_id","version"),
  CONSTRAINT "bid_package_version_check" CHECK ("version" > 0),
  CONSTRAINT "bid_package_status_check" CHECK ("status" IN ('draft','frozen','superseded'))
);

CREATE TABLE "bid"."package_file" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "package_version_id" uuid NOT NULL REFERENCES "bid"."package_version"("id") ON DELETE cascade,
  "vault_document_id" uuid REFERENCES "vault"."document"("id"),
  "document_kind" text NOT NULL,
  "envelope" text NOT NULL,
  "bucket" text NOT NULL,
  "object_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bid_package_file_object_uniq" UNIQUE("package_version_id","object_key"),
  CONSTRAINT "bid_package_file_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "bid_package_file_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bid_package_file_envelope_check" CHECK ("envelope" IN ('administrative','technical','financial','supplementary'))
);

ALTER TABLE "bid"."workspace"
  ADD CONSTRAINT "bid_workspace_official_receipt_fk"
  FOREIGN KEY ("official_receipt_evidence_id")
  REFERENCES "bid"."evidence"("id");

CREATE INDEX "bid_workspace_owner_idx" ON "bid"."workspace" ("owner_sub");
CREATE INDEX "bid_workspace_state_idx" ON "bid"."workspace" ("company_id","state");
CREATE INDEX "bid_event_workspace_time_idx" ON "bid"."event" ("workspace_id","occurred_at");
CREATE INDEX "bid_evidence_workspace_kind_idx" ON "bid"."evidence" ("workspace_id","kind");
CREATE INDEX "bid_package_file_version_idx" ON "bid"."package_file" ("package_version_id");
