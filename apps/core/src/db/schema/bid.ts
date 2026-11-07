// pg schema: bid — AGHA RM INFRA's participation workspaces and legal evidence.
import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenders } from './tender';
import { vaultDocuments } from './vault';

export const bid = pgSchema('bid');

export const bidWorkspaces = bid.table(
  'workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    ownerSub: text('owner_sub').notNull(),
    ownerName: text('owner_name').notNull(),
    signerSub: text('signer_sub'),
    state: text('state').notNull().default('evaluating'),
    version: integer('version').notNull().default(0),
    currentPackageVersion: integer('current_package_version'),
    officialReceiptEvidenceId: uuid('official_receipt_evidence_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_workspace_company_tender_uniq').on(table.companyId, table.tenderId),
    index('bid_workspace_owner_idx').on(table.ownerSub),
    index('bid_workspace_state_idx').on(table.companyId, table.state),
    check('bid_workspace_version_check', sql`${table.version} >= 0`),
    check(
      'bid_workspace_state_check',
      sql`${table.state} IN ('evaluating','go','no_go','assembling','review','frozen','awaiting_signature','signing','signed','ready_to_submit','submitting','submitted','withdrawal_pending','withdrawn','opened','won','lost','rejected','cancelled','guarantee_release_eligible','closed')`,
    ),
    check(
      'bid_workspace_receipt_pair_check',
      sql`(${table.officialReceiptEvidenceId} IS NULL AND ${table.submittedAt} IS NULL) OR (${table.officialReceiptEvidenceId} IS NOT NULL AND ${table.submittedAt} IS NOT NULL)`,
    ),
    check(
      'bid_workspace_submission_evidence_check',
      sql`${table.state} NOT IN ('submitted','withdrawal_pending','withdrawn','opened','won','lost','rejected','guarantee_release_eligible','closed') OR (${table.officialReceiptEvidenceId} IS NOT NULL AND ${table.submittedAt} IS NOT NULL)`,
    ),
  ],
);

export const bidEvents = bid.table(
  'event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    fromState: text('from_state'),
    toState: text('to_state'),
    actorSub: text('actor_sub').notNull(),
    actorName: text('actor_name').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_event_workspace_sequence_uniq').on(table.workspaceId, table.sequence),
    index('bid_event_workspace_time_idx').on(table.workspaceId, table.occurredAt),
    check('bid_event_sequence_check', sql`${table.sequence} > 0`),
  ],
);

export const bidEvidence = bid.table(
  'evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    bucket: text('bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    externalReference: text('external_reference'),
    metadata: jsonb('metadata'),
    capturedBySub: text('captured_by_sub').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedBySub: text('verified_by_sub'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    unique('bid_evidence_workspace_sha256_uniq').on(table.workspaceId, table.sha256),
    unique('bid_evidence_workspace_id_uniq').on(table.workspaceId, table.id),
    index('bid_evidence_workspace_kind_idx').on(table.workspaceId, table.kind),
    check('bid_evidence_size_check', sql`${table.sizeBytes} >= 0`),
    check('bid_evidence_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'bid_evidence_kind_check',
      sql`${table.kind} IN ('official_receipt','signed_package','portal_confirmation','portal_screenshot','result_notice','guarantee_release_receipt')`,
    ),
  ],
);

export const bidPackageVersions = bid.table(
  'package_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').notNull().default('draft'),
    manifest: jsonb('manifest'),
    manifestSha256: text('manifest_sha256'),
    createdBySub: text('created_by_sub').notNull(),
    frozenBySub: text('frozen_by_sub'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_package_workspace_version_uniq').on(table.workspaceId, table.version),
    check('bid_package_version_check', sql`${table.version} > 0`),
    check(
      'bid_package_status_check',
      sql`${table.status} IN ('draft','frozen','superseded')`,
    ),
    check(
      'bid_package_freeze_fields_check',
      sql`(${table.status} = 'frozen' AND ${table.manifest} IS NOT NULL AND ${table.manifestSha256} IS NOT NULL AND ${table.frozenBySub} IS NOT NULL AND ${table.frozenAt} IS NOT NULL) OR (${table.status} <> 'frozen')`,
    ),
  ],
);

export const bidPackageRequirements = bid.table(
  'package_requirement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    envelope: text('envelope').notNull(),
    required: boolean('required').notNull().default(true),
    requiresSignature: boolean('requires_signature').notNull().default(false),
    source: text('source').notNull().default('operator'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_package_requirement_workspace_code_uniq').on(
      table.workspaceId,
      table.code,
    ),
    index('bid_package_requirement_workspace_idx').on(table.workspaceId),
    check(
      'bid_package_requirement_envelope_check',
      sql`${table.envelope} IN ('administrative','technical','financial','supplementary')`,
    ),
    check(
      'bid_package_requirement_code_check',
      sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{1,79}$'`,
    ),
  ],
);

export const bidSigningTasks = bid.table(
  'signing_task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: 'restrict' }),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => bidPackageVersions.id, { onDelete: 'restrict' }),
    manifestSha256: text('manifest_sha256').notNull(),
    state: text('state').notNull().default('pending'),
    signerSub: text('signer_sub').notNull(),
    requestedBySub: text('requested_by_sub').notNull(),
    requestedByName: text('requested_by_name').notNull(),
    pairingSecretSha256: text('pairing_secret_sha256'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
    claimedByDeviceId: text('claimed_by_device_id'),
    claimedByDeviceName: text('claimed_by_device_name'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseSecretSha256: text('lease_secret_sha256'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bid_signing_task_workspace_idx').on(table.workspaceId, table.createdAt),
    uniqueIndex('bid_signing_task_active_workspace_uniq')
      .on(table.workspaceId)
      .where(sql`${table.state} IN ('pending','claimed')`),
    check(
      'bid_signing_task_state_check',
      sql`${table.state} IN ('pending','claimed','completed','failed','cancelled')`,
    ),
    check(
      'bid_signing_task_manifest_hash_check',
      sql`${table.manifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'bid_signing_task_pairing_hash_check',
      sql`${table.pairingSecretSha256} IS NULL OR ${table.pairingSecretSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'bid_signing_task_lease_hash_check',
      sql`${table.leaseSecretSha256} IS NULL OR ${table.leaseSecretSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const bidSigningArtifacts = bid.table(
  'signing_artifact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => bidSigningTasks.id, { onDelete: 'restrict' }),
    packageFileId: uuid('package_file_id')
      .notNull()
      .references(() => bidPackageFiles.id, { onDelete: 'restrict' }),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    certificateThumbprint: text('certificate_thumbprint').notNull(),
    certificateSubject: text('certificate_subject').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_signing_artifact_task_file_uniq').on(
      table.taskId,
      table.packageFileId,
    ),
    check('bid_signing_artifact_size_check', sql`${table.sizeBytes} > 0`),
    check(
      'bid_signing_artifact_sha256_check',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const bidSigningArtifactUploads = bid.table(
  'signing_artifact_upload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => bidSigningTasks.id, { onDelete: 'restrict' }),
    packageFileId: uuid('package_file_id')
      .notNull()
      .references(() => bidPackageFiles.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    state: text('state').notNull().default('reserved'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastError: text('last_error'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_signing_upload_object_key_uniq').on(table.objectKey),
    index('bid_signing_upload_cleanup_idx').on(table.state, table.expiresAt),
    check(
      'bid_signing_upload_state_check',
      sql`${table.state} IN ('reserved','cleanup_pending','finalized','abandoned')`,
    ),
    check('bid_signing_upload_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const bidPackageFiles = bid.table(
  'package_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => bidPackageVersions.id, { onDelete: 'restrict' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => bidPackageRequirements.id, { onDelete: 'restrict' }),
    vaultDocumentId: uuid('vault_document_id').references(() => vaultDocuments.id),
    documentKind: text('document_kind').notNull(),
    envelope: text('envelope').notNull(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bid_package_file_object_uniq').on(table.packageVersionId, table.objectKey),
    unique('bid_package_file_requirement_uniq').on(
      table.packageVersionId,
      table.requirementId,
    ),
    index('bid_package_file_version_idx').on(table.packageVersionId),
    check('bid_package_file_size_check', sql`${table.sizeBytes} >= 0`),
    check('bid_package_file_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'bid_package_file_envelope_check',
      sql`${table.envelope} IN ('administrative','technical','financial','supplementary')`,
    ),
  ],
);
