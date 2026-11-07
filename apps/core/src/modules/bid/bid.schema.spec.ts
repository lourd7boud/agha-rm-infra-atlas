import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bidEvidence,
  bidEvents,
  bidPackageFiles,
  bidPackageRequirements,
  bidPackageVersions,
  bidSigningArtifacts,
  bidSigningArtifactUploads,
  bidSigningTasks,
  bidWorkspaces,
} from '../../db/schema/bid';

describe('bid persistence schema', () => {
  it('enforces one participation workspace per company and tender', () => {
    const config = getTableConfig(bidWorkspaces);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      'bid_workspace_company_tender_uniq',
    );
  });

  it('guards workspace versions and lifecycle states in PostgreSQL', () => {
    const config = getTableConfig(bidWorkspaces);
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'bid_workspace_version_check',
        'bid_workspace_state_check',
        'bid_workspace_receipt_pair_check',
        'bid_workspace_submission_evidence_check',
      ]),
    );
  });

  it('binds an official receipt to evidence from the same workspace', () => {
    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0059_bid_workspace_integrity.sql'),
      'utf8',
    );
    expect(migration).toContain('bid_workspace_official_receipt_same_workspace_fk');
    expect(migration).toContain('bid_workspace_validate_official_receipt');
  });

  it('keeps event sequence unique within a workspace', () => {
    const config = getTableConfig(bidEvents);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      'bid_event_workspace_sequence_uniq',
    );
    expect(config.foreignKeys[0]?.onDelete).not.toBe('cascade');
  });

  it('supports official receipts as content-addressed evidence', () => {
    const config = getTableConfig(bidEvidence);
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['kind', 'sha256', 'storage_key', 'external_reference']),
    );
  });

  it('models immutable package versions and their exact files', () => {
    expect(getTableConfig(bidPackageVersions).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'version',
        'status',
        'manifest',
        'manifest_sha256',
        'frozen_at',
      ]),
    );
    expect(getTableConfig(bidPackageFiles).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'requirement_id',
        'envelope',
        'object_key',
        'sha256',
        'size_bytes',
      ]),
    );
    expect(
      getTableConfig(bidPackageFiles).uniqueConstraints.map(
        (constraint) => constraint.name,
      ),
    ).toContain('bid_package_file_requirement_uniq');
  });

  it('models tender-specific document requirements and current package ownership', () => {
    expect(
      getTableConfig(bidPackageRequirements).uniqueConstraints.map(
        (constraint) => constraint.name,
      ),
    ).toContain('bid_package_requirement_workspace_code_uniq');
    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0060_bid_package_freeze.sql'),
      'utf8',
    );
    expect(migration).toContain('bid_workspace_current_package_fk');
  });

  it('binds signing tasks to one immutable frozen manifest and one active task', () => {
    expect(getTableConfig(bidPackageRequirements).columns.map((column) => column.name)).toContain(
      'requires_signature',
    );
    expect(getTableConfig(bidSigningTasks).checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'bid_signing_task_state_check',
        'bid_signing_task_manifest_hash_check',
      ]),
    );
    expect(getTableConfig(bidSigningArtifacts).uniqueConstraints.map((item) => item.name)).toContain(
      'bid_signing_artifact_task_file_uniq',
    );

    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0061_bid_signing_protocol.sql'),
      'utf8',
    );
    expect(migration).toContain('bid_signing_task_active_workspace_uniq');
    expect(migration).toContain('bid_signing_task_validate_target');
    expect(migration).toContain('bid_signing_task_prevent_retarget');
  });

  it('rejects artifacts outside the task package and preserves their immutable evidence', () => {
    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0062_bid_signing_artifact_integrity.sql'),
      'utf8',
    );
    expect(migration).toContain('bid_signing_artifact_validate_scope');
    expect(migration).toContain('bid_signing_artifact_prevent_retarget');
    expect(migration).toContain('"requires_signature" IS TRUE');
  });

  it('persists upload reservations so interrupted S3 writes can be reclaimed', () => {
    expect(
      getTableConfig(bidSigningArtifactUploads).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        'bid_signing_upload_state_check',
        'bid_signing_upload_sha256_check',
      ]),
    );
    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0063_bid_signing_upload_outbox.sql'),
      'utf8',
    );
    expect(migration).toContain('bid_signing_upload_validate_scope');
    expect(migration).toContain('cleanup_pending');
    const integrity = readFileSync(
      join(process.cwd(), 'drizzle/0064_bid_signing_upload_integrity.sql'),
      'utf8',
    );
    expect(integrity).toContain('bid_signing_upload_prevent_retarget');
    expect(integrity).toContain('signing upload target is immutable');
  });
});
