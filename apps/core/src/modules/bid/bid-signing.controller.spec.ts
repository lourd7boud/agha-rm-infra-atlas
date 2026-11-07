import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BidRequest } from './bid.controller';
import {
  BidSigningBridgeController,
  BidSigningController,
} from './bid-signing.controller';
import { InMemoryBidSigningRepository } from './bid-signing.repository';
import { BidSigningService } from './bid-signing.service';
import { InMemoryObjectStorage } from '../vault/storage';
import { BidSigningArtifactService } from './bid-signing-artifact.service';

const request: BidRequest = {
  user: { sub: 'operator-1', username: 'Operator', roles: ['marches'] },
};

function fixture() {
  const workspaceId = randomUUID();
  const repository = new InMemoryBidSigningRepository();
  repository.seedTarget({
    workspace: {
      id: workspaceId,
      companyId: 'agha-rm-infra',
      state: 'frozen',
      version: 3,
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
        id: randomUUID(),
        requirementId: randomUUID(),
        requiresSignature: true,
        filename: 'acte.pdf',
        mime: 'application/pdf',
        sizeBytes: Buffer.byteLength('signed-input'),
        sha256: 'b'.repeat(64),
        objectKey: 'bid/task/acte.pdf',
      },
    ],
  });
  const service = new BidSigningService(repository);
  const storage = new InMemoryObjectStorage();
  void storage.put('bid/task/acte.pdf', Buffer.from('signed-input'), 'application/pdf');
  return {
    workspaceId,
    operator: new BidSigningController(service),
    bridge: new BidSigningBridgeController(
      service,
      storage,
      new BidSigningArtifactService(repository, storage),
    ),
  };
}

describe('bid signing controllers', () => {
  it('validates operator input and never returns stored secret hashes', async () => {
    const { workspaceId, operator } = fixture();
    await expect(
      operator.create(request, workspaceId, { expectedVersion: -1, signerSub: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const created = await operator.create(request, workspaceId, {
      expectedVersion: 3,
      signerSub: 'operator-1',
    });
    expect(created.pairingSecret).toHaveLength(43);
    expect(JSON.stringify(created)).not.toContain('SecretSha256');
  });

  it('claims through a one-time bridge secret and authorizes status with the lease', async () => {
    const { workspaceId, operator, bridge } = fixture();
    const created = await operator.create(request, workspaceId, {
      expectedVersion: 3,
      signerSub: 'operator-1',
    });

    await expect(
      bridge.claim(request, {
        taskId: created.task.id,
        pairingSecret: 'x'.repeat(43),
        deviceId: 'device-1',
        deviceName: 'Signing PC',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const claimed = await bridge.claim(request, {
      taskId: created.task.id,
      pairingSecret: created.pairingSecret,
      deviceId: 'device-1',
      deviceName: 'Signing PC',
    });
    const status = await bridge.status(request, claimed.task.id, claimed.leaseSecret);
    expect(status.task.state).toBe('claimed');
    expect(status.files).toHaveLength(1);
  });

  it('maps a stale operator version to conflict', async () => {
    const { workspaceId, operator } = fixture();
    await expect(
      operator.create(request, workspaceId, {
        expectedVersion: 2,
        signerSub: 'operator-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('exposes the active task without hashes and allows an audited cancellation', async () => {
    const { workspaceId, operator } = fixture();
    const created = await operator.create(request, workspaceId, {
      expectedVersion: 3,
    });

    const active = await operator.getActive(workspaceId);
    expect(active?.task.id).toBe(created.task.id);
    expect(JSON.stringify(active)).not.toContain('SecretSha256');

    const cancelled = await operator.cancel(
      request,
      workspaceId,
      created.task.id,
      { expectedVersion: 4, reason: 'Code perdu par le signataire' },
    );
    expect(cancelled.task.state).toBe('cancelled');
    expect(await operator.getActive(workspaceId)).toBeNull();
  });

  it('downloads only a file that belongs to the leased task', async () => {
    const { workspaceId, operator, bridge } = fixture();
    const created = await operator.create(request, workspaceId, {
      expectedVersion: 3,
      signerSub: 'operator-1',
    });
    const claimed = await bridge.claim(request, {
      taskId: created.task.id,
      pairingSecret: created.pairingSecret,
      deviceId: 'device-1',
      deviceName: 'Signing PC',
    });

    const download = await bridge.download(
      request,
      claimed.task.id,
      claimed.files[0]!.id,
      claimed.leaseSecret,
    );
    expect(download.getHeaders()).toMatchObject({
      type: 'application/pdf',
      length: Buffer.byteLength('signed-input'),
    });
    await expect(
      bridge.download(request, claimed.task.id, randomUUID(), claimed.leaseSecret),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stages a signed upload as unverified evidence', async () => {
    const { workspaceId, operator, bridge } = fixture();
    const created = await operator.create(request, workspaceId, {
      expectedVersion: 3,
      signerSub: 'operator-1',
    });
    const claimed = await bridge.claim(request, {
      taskId: created.task.id,
      pairingSecret: created.pairingSecret,
      deviceId: 'device-1',
      deviceName: 'Signing PC',
    });
    const buffer = Buffer.from('pdf-with-cryptographic-signature');
    const file = {
      originalname: 'acte-signed.pdf',
      mimetype: 'application/pdf',
      buffer,
      size: buffer.length,
    } as Express.Multer.File;

    const artifact = await bridge.uploadArtifact(
      request,
      claimed.task.id,
      claimed.files[0]!.id,
      claimed.leaseSecret,
      {
        certificateThumbprint: 'AA '.repeat(20),
        certificateSubject: 'CN=AGHID CONSTRUCTION',
        signedAt: '2026-10-28T12:00:00Z',
      },
      file,
    );

    expect(artifact.verifiedAt).toBeNull();
    expect(artifact.sha256).toHaveLength(64);
  });
});
