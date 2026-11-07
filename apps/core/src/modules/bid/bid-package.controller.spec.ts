import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../vault/storage';
import { InMemoryVaultRepository } from '../vault/vault.repository';
import { BidPackageController } from './bid-package.controller';
import { InMemoryBidPackageRepository } from './bid-package.repository';
import { BidPackageService } from './bid-package.service';
import type { BidRequest } from './bid.controller';

const request: BidRequest = {
  user: { sub: 'operator-1', username: 'Operator', roles: ['marches'] },
};

function fixture() {
  const workspaceId = randomUUID();
  const repository = new InMemoryBidPackageRepository();
  repository.seedWorkspace({
    id: workspaceId,
    companyId: 'agha-rm-infra',
    state: 'assembling',
    version: 0,
    currentPackageVersion: null,
  });
  const service = new BidPackageService(
    repository,
    new InMemoryVaultRepository(),
    new InMemoryObjectStorage(),
  );
  return { workspaceId, repository, controller: new BidPackageController(service) };
}

describe('BidPackageController', () => {
  it('rejects malformed requirement contracts', async () => {
    const { controller, workspaceId } = fixture();
    await expect(
      controller.defineRequirements(request, workspaceId, {
        requirements: [{ code: 'INVALID CODE', label: 'x', envelope: 'wrong' }],
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records the authenticated actor when defining requirements', async () => {
    const { controller, repository, workspaceId } = fixture();
    await controller.defineRequirements(request, workspaceId, {
      requirements: [
        {
          code: 'rc',
          label: 'Règlement de consultation',
          envelope: 'administrative',
          required: true,
        },
      ],
      expectedVersion: 0,
    });
    expect(repository.eventsFor(workspaceId)[0]).toMatchObject({
      type: 'requirements_defined',
      actorSub: 'operator-1',
    });
  });

  it('maps stale package mutations to HTTP conflict', async () => {
    const { controller, workspaceId } = fixture();
    const body = {
      requirements: [
        {
          code: 'rc',
          label: 'Règlement de consultation',
          envelope: 'administrative',
          required: true,
        },
      ],
      expectedVersion: 0,
    };
    await controller.defineRequirements(request, workspaceId, body);
    await expect(
      controller.defineRequirements(request, workspaceId, body),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
