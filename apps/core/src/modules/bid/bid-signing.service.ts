import { Inject, Injectable } from '@nestjs/common';
import type {
  CancelBidSigningTaskInput,
  ClaimBidSigningTaskInput,
  CreateBidSigningTaskInput,
} from '@atlas/contracts';
import type { BidActor } from './bid.repository';
import { createSigningSecret, hashSigningSecret } from './bid-signing.domain';
import {
  BID_SIGNING_REPOSITORY,
  type BidSigningMutationResult,
  type BidSigningRepository,
  type BidSigningTaskRecord,
  type BidSigningTaskSnapshot,
} from './bid-signing.repository';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const LEASE_TTL_MS = 30 * 60 * 1000;

export class BidSigningConflictError extends Error {
  constructor(message = 'Signing task conflict or invalid secret') {
    super(message);
    this.name = 'BidSigningConflictError';
  }
}

export class BidSigningStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidSigningStateError';
  }
}

export type BidSigningTaskView = Omit<
  BidSigningTaskRecord,
  'pairingSecretSha256' | 'leaseSecretSha256'
>;

export interface BidSigningTaskViewSnapshot {
  task: BidSigningTaskView;
  files: BidSigningTaskSnapshot['files'];
}

@Injectable()
export class BidSigningService {
  constructor(
    @Inject(BID_SIGNING_REPOSITORY)
    private readonly repository: BidSigningRepository,
  ) {}

  async createTask(
    companyId: string,
    workspaceId: string,
    input: CreateBidSigningTaskInput,
    actor: BidActor,
  ): Promise<BidSigningTaskViewSnapshot & { pairingSecret: string }> {
    const now = new Date();
    await this.repository.expireStale(companyId, workspaceId, now);
    const pairingSecret = createSigningSecret();
    const result = await this.repository.create({
      companyId,
      workspaceId,
      signerSub: input.signerSub ?? actor.sub,
      expectedVersion: input.expectedVersion,
      actor,
      pairingSecretSha256: hashSigningSecret(pairingSecret),
      pairingExpiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
      now,
    });
    const snapshot = this.unwrap(result);
    return { ...toViewSnapshot(snapshot), pairingSecret };
  }

  async getActiveTask(
    companyId: string,
    workspaceId: string,
  ): Promise<BidSigningTaskViewSnapshot | null> {
    await this.repository.expireStale(companyId, workspaceId, new Date());
    const snapshot = await this.repository.findActive(companyId, workspaceId);
    return snapshot ? toViewSnapshot(snapshot) : null;
  }

  async cancelTask(
    companyId: string,
    workspaceId: string,
    taskId: string,
    input: CancelBidSigningTaskInput,
    actor: BidActor,
  ): Promise<BidSigningTaskViewSnapshot> {
    const result = await this.repository.cancel({
      companyId,
      workspaceId,
      taskId,
      expectedVersion: input.expectedVersion,
      actor,
      reason: input.reason,
      now: new Date(),
    });
    return toViewSnapshot(this.unwrap(result));
  }

  async claimTask(
    input: ClaimBidSigningTaskInput,
    claimant: BidActor,
  ): Promise<BidSigningTaskViewSnapshot & { leaseSecret: string }> {
    const now = new Date();
    const leaseSecret = createSigningSecret();
    const result = await this.repository.claim({
      taskId: input.taskId,
      pairingSecretSha256: hashSigningSecret(input.pairingSecret),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      claimantSub: claimant.sub,
      claimantName: claimant.name,
      leaseSecretSha256: hashSigningSecret(leaseSecret),
      leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS),
      now,
    });
    // Claim failures deliberately collapse to one conflict class so the public
    // bridge endpoint does not reveal whether an id, secret or task state exists.
    if (
      result.kind === 'not_found' ||
      result.kind === 'invalid_state' ||
      result.kind === 'secret_mismatch' ||
      result.kind === 'expired'
    ) {
      throw new BidSigningConflictError('claim_rejected');
    }
    const snapshot = this.unwrap(result);
    return { ...toViewSnapshot(snapshot), leaseSecret };
  }

  async authorizeLease(
    taskId: string,
    leaseSecret: string,
    claimantSub: string,
  ): Promise<BidSigningTaskViewSnapshot> {
    return toViewSnapshot(this.unwrap(
      await this.repository.authorizeLease({
        taskId,
        claimantSub,
        leaseSecretSha256: hashSigningSecret(leaseSecret),
        now: new Date(),
      }),
    ));
  }

  private unwrap(result: BidSigningMutationResult): BidSigningTaskSnapshot {
    if (
      result.kind === 'created' ||
      result.kind === 'claimed' ||
      result.kind === 'authorized'
      || result.kind === 'cancelled'
    ) {
      return result.snapshot;
    }
    if (
      result.kind === 'version_conflict' ||
      result.kind === 'secret_mismatch' ||
      result.kind === 'expired'
    ) {
      throw new BidSigningConflictError(result.kind);
    }
    if (result.kind === 'not_found') throw new BidSigningStateError('Signing target not found');
    if (result.kind === 'artifact_recorded') {
      throw new BidSigningStateError('Unexpected artifact result');
    }
    throw new BidSigningStateError(result.reason);
  }
}

function toViewSnapshot(snapshot: BidSigningTaskSnapshot): BidSigningTaskViewSnapshot {
  const { pairingSecretSha256: _pairing, leaseSecretSha256: _lease, ...task } =
    snapshot.task;
  return { task, files: snapshot.files };
}
