import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashSigningSecret } from './bid-signing.domain';
import { BidSigningExpiryWorker } from './bid-signing-expiry.worker';
import { InMemoryBidSigningRepository } from './bid-signing.repository';
import { InMemoryObjectStorage } from '../vault/storage';

describe('BidSigningExpiryWorker', () => {
  it('recovers expired tasks without requiring an operator to open the page', async () => {
    const workspaceId = randomUUID();
    const repository = new InMemoryBidSigningRepository();
    repository.seedTarget({
      workspace: {
        id: workspaceId,
        companyId: 'agha-rm-infra',
        state: 'frozen',
        version: 1,
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
          sizeBytes: 10,
          sha256: 'b'.repeat(64),
          objectKey: 'bid/acte.pdf',
        },
      ],
    });
    const createdAt = new Date('2026-10-29T10:00:00Z');
    await repository.create({
      companyId: 'agha-rm-infra',
      workspaceId,
      signerSub: 'operator-1',
      expectedVersion: 1,
      actor: { sub: 'operator-1', name: 'Operator' },
      pairingSecretSha256: hashSigningSecret('pairing-secret'),
      pairingExpiresAt: new Date('2026-10-29T10:10:00Z'),
      now: createdAt,
    });

    const expired = await new BidSigningExpiryWorker(
      repository,
      new InMemoryObjectStorage(),
    ).sweep(
      new Date('2026-10-29T10:11:00Z'),
    );

    expect(expired).toBe(1);
    expect(repository.workspaceFor(workspaceId)).toMatchObject({
      state: 'frozen',
      version: 3,
    });
  });
});
