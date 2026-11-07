import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../vault/storage';
import { InMemoryVaultRepository } from '../vault/vault.repository';
import { BidPackageIntegrityError, BidPackageService } from './bid-package.service';
import { InMemoryBidPackageRepository } from './bid-package.repository';

const companyId = 'agha-rm-infra';
const actor = { sub: 'user-1', name: 'A. Ghabderrahim' };

async function fixture() {
  const workspaceId = randomUUID();
  const repository = new InMemoryBidPackageRepository();
  repository.seedWorkspace({
    id: workspaceId,
    companyId,
    state: 'review',
    version: 0,
    currentPackageVersion: null,
  });
  const vault = new InMemoryVaultRepository();
  const storage = new InMemoryObjectStorage('atlas-vault');
  const service = new BidPackageService(repository, vault, storage);

  async function vaultPdf(label: string, bytes: string) {
    const document = await vault.create({ kind: 'autre', label });
    const objectKey = `vault/${document.id}/${label}.pdf`;
    const stored = await storage.put(
      objectKey,
      Buffer.from(bytes, 'utf8'),
      'application/pdf',
    );
    return vault.updateFile(document.id, {
      bucket: stored.bucket,
      objectKey: stored.key,
      filename: `${label}.pdf`,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      mime: stored.mime,
    });
  }

  return { workspaceId, repository, storage, service, vaultPdf };
}

const requirementInputs = [
  {
    code: 'rc',
    label: 'Règlement de consultation',
    envelope: 'administrative' as const,
    required: true,
  },
  {
    code: 'bpu',
    label: 'Bordereau des prix',
    envelope: 'financial' as const,
    required: true,
  },
];

describe('BidPackageService', () => {
  it('snapshots Vault bytes into a bid-owned content-addressed object', async () => {
    const { workspaceId, repository, service, vaultPdf } = await fixture();
    const requirements = await service.defineRequirements(
      companyId,
      workspaceId,
      requirementInputs,
      0,
      actor,
    );
    const document = await vaultPdf('RC', 'immutable document bytes');
    if (!document) throw new Error('vault setup failed');

    const result = await service.attachFromVault(
      companyId,
      workspaceId,
      {
        requirementId: requirements.requirements[0]!.id,
        vaultDocumentId: document.id,
        expectedVersion: 1,
      },
      actor,
    );

    expect(result.workspace).toMatchObject({ version: 2, currentPackageVersion: 1 });
    expect(result.files[0]).toMatchObject({
      vaultDocumentId: document.id,
      sha256: document.sha256,
      filename: 'RC.pdf',
    });
    expect(result.files[0]!.objectKey).toContain(
      `bid/${workspaceId}/packages/1/${document.sha256}`,
    );
    expect(repository.eventsFor(workspaceId).map((event) => event.type)).toEqual([
      'requirements_defined',
      'package_file_attached',
    ]);
  });

  it('refuses to freeze while a mandatory requirement is missing', async () => {
    const { workspaceId, service, vaultPdf } = await fixture();
    const defined = await service.defineRequirements(
      companyId,
      workspaceId,
      requirementInputs,
      0,
      actor,
    );
    const document = await vaultPdf('RC', 'rc');
    if (!document) throw new Error('vault setup failed');
    await service.attachFromVault(
      companyId,
      workspaceId,
      {
        requirementId: defined.requirements[0]!.id,
        vaultDocumentId: document.id,
        expectedVersion: 1,
      },
      actor,
    );

    await expect(
      service.freeze(companyId, workspaceId, { expectedVersion: 2 }, actor),
    ).rejects.toThrow('Missing required package documents: bpu');
  });

  it('detects stored-byte tampering before freeze', async () => {
    const { workspaceId, service, storage, vaultPdf } = await fixture();
    const defined = await service.defineRequirements(
      companyId,
      workspaceId,
      [requirementInputs[0]!],
      0,
      actor,
    );
    const document = await vaultPdf('RC', 'trusted');
    if (!document) throw new Error('vault setup failed');
    const attached = await service.attachFromVault(
      companyId,
      workspaceId,
      {
        requirementId: defined.requirements[0]!.id,
        vaultDocumentId: document.id,
        expectedVersion: 1,
      },
      actor,
    );
    await storage.put(
      attached.files[0]!.objectKey,
      Buffer.from('tampered', 'utf8'),
      'application/pdf',
    );

    await expect(
      service.freeze(companyId, workspaceId, { expectedVersion: 2 }, actor),
    ).rejects.toBeInstanceOf(BidPackageIntegrityError);
  });

  it('atomically freezes a complete verified package with its canonical manifest', async () => {
    const { workspaceId, repository, service, vaultPdf } = await fixture();
    const defined = await service.defineRequirements(
      companyId,
      workspaceId,
      requirementInputs,
      0,
      actor,
    );
    let version = 1;
    for (const [index, requirement] of defined.requirements.entries()) {
      const document = await vaultPdf(requirement.code, `bytes-${index}`);
      if (!document) throw new Error('vault setup failed');
      await service.attachFromVault(
        companyId,
        workspaceId,
        {
          requirementId: requirement.id,
          vaultDocumentId: document.id,
          expectedVersion: version,
        },
        actor,
      );
      version += 1;
    }

    const frozen = await service.freeze(
      companyId,
      workspaceId,
      { expectedVersion: version },
      actor,
    );

    expect(frozen.workspace).toMatchObject({ state: 'frozen', version: version + 1 });
    expect(frozen.packageVersion).toMatchObject({
      status: 'frozen',
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      frozenBySub: actor.sub,
    });
    if (!frozen.packageVersion) throw new Error('frozen package missing');
    expect(frozen.packageVersion.manifest).toMatchObject({
      schema: 'atlas.bid-package-manifest.v1',
      workspaceId,
      version: 1,
    });
    expect(repository.eventsFor(workspaceId).at(-1)?.type).toBe('package_frozen');
  });
});
