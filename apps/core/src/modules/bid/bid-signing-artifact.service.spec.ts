import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage, sha256Hex } from '../vault/storage';
import { InMemoryBidSigningRepository } from './bid-signing.repository';
import { BidSigningService } from './bid-signing.service';
import {
  BidSigningArtifactService,
  BidSigningArtifactStateError,
} from './bid-signing-artifact.service';

async function claimedFixture() {
  const workspaceId = randomUUID();
  const fileId = randomUUID();
  const source = Buffer.from('original-pdf-bytes');
  const repository = new InMemoryBidSigningRepository();
  repository.seedTarget({
    workspace: {
      id: workspaceId,
      companyId: 'agha-rm-infra',
      state: 'frozen',
      version: 2,
      currentPackageVersion: 1,
    },
    packageVersion: {
      id: randomUUID(),
      version: 1,
      status: 'frozen',
      manifestSha256: 'a'.repeat(64),
    },
    files: [
      {
        id: fileId,
        requirementId: randomUUID(),
        requiresSignature: true,
        filename: 'acte.pdf',
        mime: 'application/pdf',
        sizeBytes: source.length,
        sha256: sha256Hex(source),
        objectKey: 'bid/source/acte.pdf',
      },
    ],
  });
  const signing = new BidSigningService(repository);
  const created = await signing.createTask(
    'agha-rm-infra',
    workspaceId,
    { expectedVersion: 2 },
    { sub: 'operator-1', name: 'Operator' },
  );
  const claimed = await signing.claimTask({
    taskId: created.task.id,
    pairingSecret: created.pairingSecret,
    deviceId: 'device-1',
    deviceName: 'Signing PC',
  }, { sub: 'operator-1', name: 'Operator' });
  const storage = new InMemoryObjectStorage();
  return {
    repository,
    storage,
    source,
    fileId,
    claimed,
    service: new BidSigningArtifactService(repository, storage),
  };
}

const certificate = {
  certificateThumbprint: 'a'.repeat(40),
  certificateSubject: 'CN=AGHID CONSTRUCTION',
  signedAt: new Date('2026-10-28T12:00:00Z'),
};

describe('BidSigningArtifactService', () => {
  it('stores a content-addressed unverified signed artifact without changing legal state', async () => {
    const { service, storage, claimed, fileId, repository } = await claimedFixture();
    const signed = Buffer.from('signed-pdf-with-cms');

    const artifact = await service.stage(
      claimed.task.id,
      claimed.leaseSecret,
      'operator-1',
      fileId,
      { filename: 'acte-signed.pdf', mime: 'application/pdf', body: signed },
      certificate,
    );

    expect(artifact.sha256).toBe(sha256Hex(signed));
    expect(artifact.verifiedAt).toBeNull();
    expect(storage.get(artifact.objectKey)?.body).toEqual(signed);
    expect(repository.workspaceFor(claimed.task.workspaceId)?.state).toBe('signing');
  });

  it('is idempotent for the same bytes and rejects replacing an artifact', async () => {
    const { service, storage, claimed, fileId } = await claimedFixture();
    const upload = {
      filename: 'acte-signed.pdf',
      mime: 'application/pdf',
      body: Buffer.from('signed-version-one'),
    };
    const first = await service.stage(
      claimed.task.id,
      claimed.leaseSecret,
      'operator-1',
      fileId,
      upload,
      certificate,
    );
    const replay = await service.stage(
      claimed.task.id,
      claimed.leaseSecret,
      'operator-1',
      fileId,
      upload,
      certificate,
    );
    expect(replay.id).toBe(first.id);

    const rejected = Buffer.from('different-signed-version');
    await expect(
      service.stage(
        claimed.task.id,
        claimed.leaseSecret,
        'operator-1',
        fileId,
        { ...upload, body: rejected },
        certificate,
      ),
    ).rejects.toThrow(BidSigningArtifactStateError);
    const orphanKey = `bid/${claimed.task.workspaceId}/signing/${claimed.task.id}/${fileId}/${sha256Hex(rejected)}/acte-signed.pdf`;
    expect(storage.get(orphanKey)).toBeUndefined();
  });

  it('rejects bytes identical to the frozen input', async () => {
    const { service, claimed, fileId, source } = await claimedFixture();
    await expect(
      service.stage(
        claimed.task.id,
        claimed.leaseSecret,
        'operator-1',
        fileId,
        { filename: 'acte.pdf', mime: 'application/pdf', body: source },
        certificate,
      ),
    ).rejects.toThrow(/identical to frozen input/);
  });
});
