import { Inject, Injectable } from '@nestjs/common';
import type { TransitionBidWorkspaceInput } from '@atlas/contracts';
import { assertBidTransition } from './bid.domain';
import {
  BID_WORKSPACE_REPOSITORY,
  type BidActor,
  type BidWorkspaceRecord,
  type BidWorkspaceRepository,
} from './bid.repository';

export class BidWorkspaceNotFoundError extends Error {
  constructor() {
    super('Bid workspace not found');
    this.name = 'BidWorkspaceNotFoundError';
  }
}

export class BidWorkspaceVersionConflictError extends Error {
  constructor() {
    super('Bid workspace changed in another session; reload before retrying');
    this.name = 'BidWorkspaceVersionConflictError';
  }
}

@Injectable()
export class BidWorkspaceService {
  constructor(
    @Inject(BID_WORKSPACE_REPOSITORY)
    private readonly repository: BidWorkspaceRepository,
  ) {}

  start(companyId: string, tenderId: string, actor: BidActor): Promise<BidWorkspaceRecord> {
    return this.repository.start({ companyId, tenderId, actor });
  }

  async getByTender(
    companyId: string,
    tenderId: string,
  ): Promise<BidWorkspaceRecord | null> {
    return this.repository.findByTender(companyId, tenderId);
  }

  async get(companyId: string, workspaceId: string): Promise<BidWorkspaceRecord> {
    const workspace = await this.repository.findById(companyId, workspaceId);
    if (!workspace) throw new BidWorkspaceNotFoundError();
    return workspace;
  }

  async transition(
    companyId: string,
    workspaceId: string,
    input: TransitionBidWorkspaceInput,
    actor: BidActor,
  ): Promise<BidWorkspaceRecord> {
    const current = await this.repository.findById(companyId, workspaceId);
    if (!current) throw new BidWorkspaceNotFoundError();
    if (current.version !== input.expectedVersion) {
      throw new BidWorkspaceVersionConflictError();
    }

    assertBidTransition(current.state, input.to);
    const result = await this.repository.transition({
      companyId,
      workspaceId,
      fromState: current.state,
      toState: input.to,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      actor,
    });
    if (result.kind === 'not_found') throw new BidWorkspaceNotFoundError();
    if (result.kind === 'version_conflict') {
      throw new BidWorkspaceVersionConflictError();
    }
    return result.workspace;
  }
}
