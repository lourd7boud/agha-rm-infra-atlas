import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BidController, type BidRequest } from './bid.controller';
import { InMemoryBidWorkspaceRepository } from './bid.repository';
import { BidWorkspaceService } from './bid.service';

const tenderId = '11111111-1111-4111-8111-111111111111';
const request: BidRequest = {
  user: { sub: 'signer-1', username: 'Abderrahim', roles: ['marches'] },
};

function controller(): BidController {
  return new BidController(
    new BidWorkspaceService(new InMemoryBidWorkspaceRepository()),
  );
}

describe('BidController', () => {
  it('rejects malformed start payloads before they reach the service', async () => {
    await expect(controller().start(request, { tenderId: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records the authenticated caller as workspace owner', async () => {
    const workspace = await controller().start(request, { tenderId });

    expect(workspace).toMatchObject({
      tenderId,
      ownerSub: 'signer-1',
      ownerName: 'Abderrahim',
      state: 'evaluating',
    });
  });

  it('maps optimistic concurrency failures to HTTP conflict', async () => {
    const target = controller();
    const workspace = await target.start(request, { tenderId });
    await target.transition(request, workspace.id, {
      to: 'go',
      expectedVersion: 0,
    });

    await expect(
      target.transition(request, workspace.id, {
        to: 'no_go',
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps missing workspaces to HTTP not found', async () => {
    await expect(
      controller().get(
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects malformed workspace identifiers as client input', async () => {
    await expect(controller().get('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses a stable dev actor when authentication is disabled locally', async () => {
    const workspace = await controller().start({}, { tenderId });
    expect(workspace).toMatchObject({ ownerSub: 'dev-mode', ownerName: 'dev-mode' });
  });
});
