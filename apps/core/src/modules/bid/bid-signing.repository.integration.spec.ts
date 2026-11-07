import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import * as schema from '../../db/schema';
import { bidSigningArtifacts } from '../../db/schema/bid';
import { tenders } from '../../db/schema/tender';
import { DrizzleBidPackageRepository } from './bid-package.repository';
import { hashSigningSecret } from './bid-signing.domain';
import { DrizzleBidSigningRepository } from './bid-signing.repository';
import { DrizzleBidWorkspaceRepository } from './bid.repository';

const databaseUrl = process.env.BID_INTEGRATION_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const companyId = 'agha-rm-infra-signing-integration';
const actor = { sub: 'signing-integration', name: 'Signing Integration' };

describeWithDatabase('DrizzleBidSigningRepository integration', () => {
  let pool: Pool;
  let db: Db;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Db;
  });

  afterAll(async () => {
    // Frozen-package immutability triggers correctly block ordinary deletion.
    // Integration cleanup runs only against the explicitly supplied disposable
    // test database, so disable user triggers transaction-locally and remove the
    // isolated company namespace (also catches residue from an interrupted run).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE bid.package_file DISABLE TRIGGER bid_package_file_immutable',
      );
      await client.query(
        'ALTER TABLE bid.package_version DISABLE TRIGGER bid_package_version_immutable',
      );
      await client.query(
        'ALTER TABLE bid.signing_artifact DISABLE TRIGGER bid_signing_artifact_prevent_retarget',
      );
      await client.query(
        'ALTER TABLE bid.signing_artifact_upload DISABLE TRIGGER bid_signing_upload_prevent_retarget',
      );
      await client.query(
        `DELETE FROM bid.signing_artifact WHERE task_id IN (
          SELECT task.id FROM bid.signing_task task
          JOIN bid.workspace workspace ON workspace.id = task.workspace_id
          WHERE workspace.company_id = $1
        )`,
        [companyId],
      );
      await client.query(
        `DELETE FROM bid.signing_artifact_upload WHERE task_id IN (
          SELECT task.id FROM bid.signing_task task
          JOIN bid.workspace workspace ON workspace.id = task.workspace_id
          WHERE workspace.company_id = $1
        )`,
        [companyId],
      );
      await client.query(
        'DELETE FROM bid.signing_task WHERE workspace_id IN (SELECT id FROM bid.workspace WHERE company_id = $1)',
        [companyId],
      );
      await client.query(
        'DELETE FROM bid.package_file WHERE package_version_id IN (SELECT id FROM bid.package_version WHERE workspace_id IN (SELECT id FROM bid.workspace WHERE company_id = $1))',
        [companyId],
      );
      await client.query(
        'DELETE FROM bid.package_requirement WHERE workspace_id IN (SELECT id FROM bid.workspace WHERE company_id = $1)',
        [companyId],
      );
      await client.query(
        'UPDATE bid.workspace SET current_package_version = NULL WHERE company_id = $1',
        [companyId],
      );
      await client.query(
        'DELETE FROM bid.package_version WHERE workspace_id IN (SELECT id FROM bid.workspace WHERE company_id = $1)',
        [companyId],
      );
      await client.query(
        'DELETE FROM bid.event WHERE workspace_id IN (SELECT id FROM bid.workspace WHERE company_id = $1)',
        [companyId],
      );
      await client.query('DELETE FROM bid.workspace WHERE company_id = $1', [companyId]);
      await client.query(
        'DELETE FROM radar.candidate WHERE tender_id IN (SELECT id FROM tender.tender WHERE company_id = $1)',
        [companyId],
      );
      await client.query('DELETE FROM tender.tender WHERE company_id = $1', [companyId]);
      await client.query(
        'ALTER TABLE bid.package_file ENABLE TRIGGER bid_package_file_immutable',
      );
      await client.query(
        'ALTER TABLE bid.package_version ENABLE TRIGGER bid_package_version_immutable',
      );
      await client.query(
        'ALTER TABLE bid.signing_artifact ENABLE TRIGGER bid_signing_artifact_prevent_retarget',
      );
      await client.query(
        'ALTER TABLE bid.signing_artifact_upload ENABLE TRIGGER bid_signing_upload_prevent_retarget',
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.end();
  });

  async function frozenTarget() {
    const workspaceRepository = new DrizzleBidWorkspaceRepository(db);
    const packageRepository = new DrizzleBidPackageRepository(db);
    const tenderId = randomUUID();
    await db.insert(tenders).values({
      id: tenderId,
      companyId,
      reference: `SIGNING-${tenderId}`,
      buyerName: 'Signing Integration Buyer',
      procedure: "Appel d'offres ouvert",
      objet: 'Signing task concurrency test',
      deadlineAt: new Date('2030-01-01T12:00:00Z'),
    });
    let workspace = await workspaceRepository.start({ companyId, tenderId, actor });
    for (const toState of ['go', 'assembling', 'review'] as const) {
      const result = await workspaceRepository.transition({
        companyId,
        workspaceId: workspace.id,
        fromState: workspace.state,
        toState,
        expectedVersion: workspace.version,
        actor,
      });
      if (result.kind !== 'updated') throw new Error('workspace setup failed');
      workspace = result.workspace;
    }
    const defined = await packageRepository.defineRequirements({
      companyId,
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
      actor,
      requirements: [
        {
          code: 'acte_engagement',
          label: "Acte d'engagement",
          envelope: 'administrative',
          required: true,
          requiresSignature: true,
        },
      ],
    });
    if (defined.kind !== 'updated') throw new Error('requirement setup failed');
    const attached = await packageRepository.attachFile({
      companyId,
      workspaceId: workspace.id,
      requirementId: defined.snapshot.requirements[0]!.id,
      expectedVersion: defined.snapshot.workspace.version,
      actor,
      file: {
        vaultDocumentId: null,
        documentKind: 'autre',
        envelope: 'administrative',
        bucket: 'atlas-vault',
        objectKey: `bid-signing-test/${randomUUID()}`,
        filename: 'acte.pdf',
        mime: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    });
    if (attached.kind !== 'updated' || !attached.snapshot.packageVersion) {
      throw new Error('file setup failed');
    }
    const frozen = await packageRepository.freeze({
      companyId,
      workspaceId: workspace.id,
      packageVersionId: attached.snapshot.packageVersion.id,
      expectedVersion: attached.snapshot.workspace.version,
      manifest: { schema: 'atlas.bid-package-manifest.v1' },
      manifestSha256: 'b'.repeat(64),
      actor,
    });
    if (frozen.kind !== 'updated') throw new Error('freeze setup failed');
    return frozen.snapshot;
  }

  it('allows one active task and one bridge claim under real concurrency', async () => {
    const target = await frozenTarget();
    const repository = new DrizzleBidSigningRepository(db);
    const now = new Date();
    const pairingSecret = 'pairing-secret-for-integration';
    const createCommand = {
      companyId,
      workspaceId: target.workspace.id,
      signerSub: actor.sub,
      expectedVersion: target.workspace.version,
      actor,
      pairingSecretSha256: hashSigningSecret(pairingSecret),
      pairingExpiresAt: new Date(now.getTime() + 600_000),
      now,
    };

    const creates = await Promise.all([
      repository.create(createCommand),
      repository.create({ ...createCommand, pairingSecretSha256: 'c'.repeat(64) }),
    ]);
    const created = creates.find((result) => result.kind === 'created');
    expect(creates.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(created?.kind).toBe('created');
    if (created?.kind !== 'created') throw new Error('no created task');

    const claimCommand = {
      taskId: created.snapshot.task.id,
      pairingSecretSha256: hashSigningSecret(pairingSecret),
      deviceId: 'device-integration',
      deviceName: 'Integration Signing PC',
      claimantSub: actor.sub,
      claimantName: actor.name,
      leaseSecretSha256: 'd'.repeat(64),
      leaseExpiresAt: new Date(now.getTime() + 1_800_000),
      now: new Date(now.getTime() + 1_000),
    };
    const claims = await Promise.all([
      repository.claim(claimCommand),
      repository.claim({ ...claimCommand, deviceId: 'device-racer' }),
    ]);
    expect(claims.filter((result) => result.kind === 'claimed')).toHaveLength(1);
    expect(
      await repository.authorizeLease({
        taskId: created.snapshot.task.id,
        claimantSub: actor.sub,
        leaseSecretSha256: 'd'.repeat(64),
        now: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ kind: 'authorized' });

    const artifactObjectKey = `signed/${randomUUID()}.pdf`;
    const reservation = await repository.reserveArtifactUpload({
      taskId: created.snapshot.task.id,
      packageFileId: created.snapshot.files[0]!.id,
      claimantSub: actor.sub,
      leaseSecretSha256: 'd'.repeat(64),
      objectKey: artifactObjectKey,
      sha256: 'e'.repeat(64),
      expiresAt: new Date(now.getTime() + 7_200_000),
      now: new Date(now.getTime() + 2_500),
    });
    expect(reservation.kind).toBe('reserved');
    if (reservation.kind !== 'reserved') throw new Error('no upload reservation');
    const validArtifact = await repository.recordArtifact({
      reservationId: reservation.reservation.id,
      taskId: created.snapshot.task.id,
      packageFileId: created.snapshot.files[0]!.id,
      claimantSub: actor.sub,
      leaseSecretSha256: 'd'.repeat(64),
      now: new Date(now.getTime() + 3_000),
      artifact: {
        bucket: 'atlas-vault',
        objectKey: artifactObjectKey,
        filename: 'acte-signed.pdf',
        mime: 'application/pdf',
        sizeBytes: 12,
        sha256: 'e'.repeat(64),
        certificateThumbprint: 'f'.repeat(40),
        certificateSubject: 'CN=Signing Integration',
        signedAt: new Date(now.getTime() + 2_500),
      },
    });
    expect(validArtifact).toMatchObject({ kind: 'artifact_recorded' });

    const unrelatedTarget = await frozenTarget();
    let scopeError: unknown;
    try {
      await db.insert(bidSigningArtifacts).values({
        taskId: created.snapshot.task.id,
        packageFileId: unrelatedTarget.files[0]!.id,
        bucket: 'atlas-vault',
        objectKey: `signed/${randomUUID()}.pdf`,
        filename: 'foreign-signed.pdf',
        mime: 'application/pdf',
        sizeBytes: 12,
        sha256: '1'.repeat(64),
        certificateThumbprint: '2'.repeat(40),
        certificateSubject: 'CN=Wrong Scope',
        signedAt: new Date(now.getTime() + 4_000),
      });
    } catch (error) {
      scopeError = error;
    }
    expect(scopeError).toBeDefined();
    expect(
      String((scopeError as { cause?: { message?: string } }).cause?.message ?? scopeError),
    ).toMatch(/outside the task signature scope/);
  });
});
