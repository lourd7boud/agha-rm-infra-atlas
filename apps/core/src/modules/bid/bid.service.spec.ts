import { describe, expect, it } from 'vitest';
import { InMemoryBidWorkspaceRepository } from './bid.repository';
import {
  BidWorkspaceService,
  BidWorkspaceVersionConflictError,
} from './bid.service';

const actor = { sub: 'user-1', name: 'A. Ghabderrahim' };
const companyId = 'agha-rm-infra';
const tenderId = '11111111-1111-4111-8111-111111111111';

describe('BidWorkspaceService', () => {
  it('starts one idempotent workspace per company and tender', async () => {
    const repository = new InMemoryBidWorkspaceRepository();
    const service = new BidWorkspaceService(repository);

    const first = await service.start(companyId, tenderId, actor);
    const second = await service.start(companyId, tenderId, actor);

    expect(second.id).toBe(first.id);
    expect(second.state).toBe('evaluating');
    expect(repository.eventsFor(first.id)).toHaveLength(1);
    expect(repository.eventsFor(first.id)[0]).toMatchObject({
      sequence: 1,
      type: 'workspace_started',
      actorSub: actor.sub,
    });
  });

  it('changes state and appends the event as one versioned operation', async () => {
    const repository = new InMemoryBidWorkspaceRepository();
    const service = new BidWorkspaceService(repository);
    const workspace = await service.start(companyId, tenderId, actor);

    const changed = await service.transition(
      companyId,
      workspace.id,
      { to: 'go', expectedVersion: 0, reason: 'Dossier stratégique' },
      actor,
    );

    expect(changed).toMatchObject({ state: 'go', version: 1 });
    expect(repository.eventsFor(workspace.id)).toHaveLength(2);
    expect(repository.eventsFor(workspace.id)[1]).toMatchObject({
      sequence: 2,
      fromState: 'evaluating',
      toState: 'go',
      reason: 'Dossier stratégique',
    });
  });

  it('rejects a stale tab without appending an event', async () => {
    const repository = new InMemoryBidWorkspaceRepository();
    const service = new BidWorkspaceService(repository);
    const workspace = await service.start(companyId, tenderId, actor);
    await service.transition(
      companyId,
      workspace.id,
      { to: 'go', expectedVersion: 0 },
      actor,
    );

    await expect(
      service.transition(
        companyId,
        workspace.id,
        { to: 'no_go', expectedVersion: 0 },
        actor,
      ),
    ).rejects.toBeInstanceOf(BidWorkspaceVersionConflictError);
    expect(repository.eventsFor(workspace.id)).toHaveLength(2);
  });

  it('does not append an event for an illegal transition', async () => {
    const repository = new InMemoryBidWorkspaceRepository();
    const service = new BidWorkspaceService(repository);
    const workspace = await service.start(companyId, tenderId, actor);

    await expect(
      service.transition(
        companyId,
        workspace.id,
        { to: 'frozen', expectedVersion: 0 },
        actor,
      ),
    ).rejects.toThrow('Illegal bid workspace transition: evaluating → frozen');
    expect(repository.eventsFor(workspace.id)).toHaveLength(1);
  });

  it('refuses to mark a submitting workspace submitted without receipt evidence', async () => {
    const repository = new InMemoryBidWorkspaceRepository();
    const service = new BidWorkspaceService(repository);
    let workspace = await service.start(companyId, tenderId, actor);
    const seeded = await repository.transition({
      companyId,
      workspaceId: workspace.id,
      fromState: 'evaluating',
      toState: 'submitting',
      expectedVersion: 0,
      actor,
    });
    if (seeded.kind !== 'updated') throw new Error('test setup failed');
    workspace = seeded.workspace;

    await expect(
      service.transition(
        companyId,
        workspace.id,
        { to: 'submitted', expectedVersion: workspace.version },
        actor,
      ),
    ).rejects.toThrow('Official receipt is required to mark a bid as submitted');
    expect(repository.eventsFor(workspace.id)).toHaveLength(2);
  });
});
