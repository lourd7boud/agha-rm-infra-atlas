import { describe, expect, it } from 'vitest';
import { InMemoryBidSigningRepository } from './bid-signing.repository';
import {
  BidSigningConflictError,
  BidSigningService,
  BidSigningStateError,
} from './bid-signing.service';

function readyRepository(): InMemoryBidSigningRepository {
  const repository = new InMemoryBidSigningRepository();
  repository.seedTarget({
    workspace: {
      id: '9f4bc9cc-93a9-49db-8e7e-3a85450f07e5',
      companyId: 'agha-rm-infra',
      state: 'frozen',
      version: 7,
      currentPackageVersion: 1,
    },
    packageVersion: {
      id: '5c9f1477-bae1-41c2-93af-0f7f5fac932a',
      version: 1,
      status: 'frozen',
      manifestSha256: 'a'.repeat(64),
    },
    files: [
      {
        id: '31353b1d-0be9-4693-a89f-a9d6109e8d43',
        requirementId: 'req-sign',
        requiresSignature: true,
        filename: 'acte-engagement.pdf',
        mime: 'application/pdf',
        sizeBytes: 128,
        sha256: 'b'.repeat(64),
        objectKey: 'bid/w/p1/acte.pdf',
      },
      {
        id: '145c6a25-cd86-40cc-9379-aafc28bb3782',
        requirementId: 'req-readonly',
        requiresSignature: false,
        filename: 'rc.pdf',
        mime: 'application/pdf',
        sizeBytes: 64,
        sha256: 'c'.repeat(64),
        objectKey: 'bid/w/p1/rc.pdf',
      },
    ],
  });
  return repository;
}

const actor = { sub: 'operator-1', name: 'Direction générale' };
const workspaceId = '9f4bc9cc-93a9-49db-8e7e-3a85450f07e5';

describe('BidSigningService', () => {
  it('creates a one-time pairing task for only the operator-confirmed files', async () => {
    const repository = readyRepository();
    const service = new BidSigningService(repository);

    const result = await service.createTask(
      'agha-rm-infra',
      workspaceId,
      { expectedVersion: 7, signerSub: 'operator-1' },
      actor,
    );

    expect(result.pairingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.task.state).toBe('pending');
    expect(result.task.manifestSha256).toBe('a'.repeat(64));
    expect(result.files.map((file) => file.filename)).toEqual(['acte-engagement.pdf']);
    expect(JSON.stringify(repository.taskFor(workspaceId))).not.toContain(
      result.pairingSecret,
    );
    expect(repository.workspaceFor(workspaceId)?.state).toBe('awaiting_signature');
  });

  it('rejects stale versions and a second active task', async () => {
    const repository = readyRepository();
    const service = new BidSigningService(repository);

    await expect(
      service.createTask(
        'agha-rm-infra',
        workspaceId,
        { expectedVersion: 6, signerSub: 'operator-1' },
        actor,
      ),
    ).rejects.toThrow(BidSigningConflictError);

    await service.createTask(
      'agha-rm-infra',
      workspaceId,
      { expectedVersion: 7, signerSub: 'operator-1' },
      actor,
    );
    await expect(
      service.createTask(
        'agha-rm-infra',
        workspaceId,
        { expectedVersion: 8, signerSub: 'operator-1' },
        actor,
      ),
    ).rejects.toThrow(BidSigningStateError);
  });

  it('claims once, rotates to a lease secret and moves the workspace to signing', async () => {
    const repository = readyRepository();
    const service = new BidSigningService(repository);
    const created = await service.createTask(
      'agha-rm-infra',
      workspaceId,
      { expectedVersion: 7, signerSub: 'operator-1' },
      actor,
    );

    await expect(
      service.claimTask({
        taskId: created.task.id,
        pairingSecret: created.pairingSecret,
        deviceId: 'device-unauthorized',
        deviceName: 'Other signer PC',
      }, { sub: 'operator-2', name: 'Other signer' }),
    ).rejects.toThrow(BidSigningConflictError);

    await expect(
      service.claimTask({
        taskId: created.task.id,
        pairingSecret: 'x'.repeat(43),
        deviceId: 'device-1',
        deviceName: 'PC Signature',
      }, actor),
    ).rejects.toThrow(BidSigningConflictError);

    const claimed = await service.claimTask({
      taskId: created.task.id,
      pairingSecret: created.pairingSecret,
      deviceId: 'device-1',
      deviceName: 'PC Signature',
    }, actor);
    expect(claimed.leaseSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claimed.task.state).toBe('claimed');
    expect(repository.workspaceFor(workspaceId)?.state).toBe('signing');
    expect(
      await service.authorizeLease(
        created.task.id,
        claimed.leaseSecret,
        actor.sub,
      ),
    ).toBeDefined();
    await expect(
      service.authorizeLease(
        created.task.id,
        claimed.leaseSecret,
        'operator-2',
      ),
    ).rejects.toThrow(BidSigningConflictError);
    await expect(
      service.claimTask({
        taskId: created.task.id,
        pairingSecret: created.pairingSecret,
        deviceId: 'device-2',
        deviceName: 'Other PC',
      }, actor),
    ).rejects.toThrow(BidSigningConflictError);
  });

  it('cancels an active task and returns the immutable package to frozen', async () => {
    const repository = readyRepository();
    const service = new BidSigningService(repository);
    const created = await service.createTask(
      'agha-rm-infra',
      workspaceId,
      { expectedVersion: 7 },
      actor,
    );

    const cancelled = await service.cancelTask(
      'agha-rm-infra',
      workspaceId,
      created.task.id,
      { expectedVersion: 8, reason: 'Le signataire a refusé la tâche' },
      actor,
    );

    expect(cancelled.task.state).toBe('cancelled');
    expect(repository.workspaceFor(workspaceId)).toMatchObject({
      state: 'frozen',
      version: 9,
    });
    expect(await service.getActiveTask('agha-rm-infra', workspaceId)).toBeNull();
  });

  it('automatically expires a stale pairing task and recovers the workspace', async () => {
    const repository = readyRepository();
    const service = new BidSigningService(repository);
    await service.createTask(
      'agha-rm-infra',
      workspaceId,
      { expectedVersion: 7 },
      actor,
    );

    const expired = await repository.expireStale(
      'agha-rm-infra',
      workspaceId,
      new Date(Date.now() + 11 * 60 * 1000),
    );

    expect(expired).toBe(true);
    expect(repository.workspaceFor(workspaceId)).toMatchObject({
      state: 'frozen',
      version: 9,
    });
  });
});
