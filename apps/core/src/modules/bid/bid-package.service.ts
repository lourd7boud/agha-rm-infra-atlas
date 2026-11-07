import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AttachBidPackageFileInput,
  BidPackageRequirementInput,
  FreezeBidPackageInput,
} from '@atlas/contracts';
import { OBJECT_STORAGE, sanitizeFilename, type ObjectStorage } from '../vault/storage';
import { VAULT_REPOSITORY, type VaultRepository } from '../vault/vault.repository';
import {
  assertPackageComplete,
  buildPackageManifest,
  type PackageFileForManifest,
} from './bid-package.domain';
import {
  BID_PACKAGE_REPOSITORY,
  type BidPackageMutationResult,
  type BidPackageRepository,
  type BidPackageSnapshot,
} from './bid-package.repository';
import type { BidActor } from './bid.repository';
import {
  BidWorkspaceNotFoundError,
  BidWorkspaceVersionConflictError,
} from './bid.service';

export class BidPackageStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidPackageStateError';
  }
}

export class BidPackageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidPackageIntegrityError';
  }
}

@Injectable()
export class BidPackageService {
  constructor(
    @Inject(BID_PACKAGE_REPOSITORY)
    private readonly repository: BidPackageRepository,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async get(companyId: string, workspaceId: string): Promise<BidPackageSnapshot> {
    const snapshot = await this.repository.findSnapshot(companyId, workspaceId);
    if (!snapshot) throw new BidWorkspaceNotFoundError();
    return snapshot;
  }

  async defineRequirements(
    companyId: string,
    workspaceId: string,
    requirements: readonly BidPackageRequirementInput[],
    expectedVersion: number,
    actor: BidActor,
  ): Promise<BidPackageSnapshot> {
    return this.unwrap(
      await this.repository.defineRequirements({
        companyId,
        workspaceId,
        requirements,
        expectedVersion,
        actor,
      }),
    );
  }

  async attachFromVault(
    companyId: string,
    workspaceId: string,
    input: AttachBidPackageFileInput,
    actor: BidActor,
  ): Promise<BidPackageSnapshot> {
    const snapshot = await this.get(companyId, workspaceId);
    if (snapshot.workspace.version !== input.expectedVersion) {
      throw new BidWorkspaceVersionConflictError();
    }
    const requirement = snapshot.requirements.find(
      (candidate) => candidate.id === input.requirementId,
    );
    if (!requirement) throw new BidPackageStateError('Package requirement not found');
    const document = await this.vault.findById(input.vaultDocumentId);
    if (!document?.objectKey) {
      throw new BidPackageStateError('Vault document has no attached file');
    }
    const source = await readStoredObject(this.storage, document.objectKey);
    const actualSha256 = sha256(source.body);
    if (document.sha256 && document.sha256 !== actualSha256) {
      throw new BidPackageIntegrityError('Vault object hash does not match its record');
    }
    if (document.sizeBytes !== undefined && document.sizeBytes !== source.body.length) {
      throw new BidPackageIntegrityError('Vault object size does not match its record');
    }
    const packageNumber = snapshot.packageVersion?.version ?? 1;
    const filename = sanitizeFilename(
      document.filename ?? document.objectKey.split('/').at(-1) ?? 'document',
    );
    const targetKey = `bid/${workspaceId}/packages/${packageNumber}/${actualSha256}/${filename}`;
    const stored = await this.storage.put(targetKey, source.body, source.mime);
    if (stored.sha256 !== actualSha256) {
      throw new BidPackageIntegrityError('Package snapshot hash changed during storage');
    }
    return this.unwrap(
      await this.repository.attachFile({
        companyId,
        workspaceId,
        requirementId: requirement.id,
        expectedVersion: input.expectedVersion,
        actor,
        file: {
          vaultDocumentId: document.id,
          documentKind: document.kind,
          envelope: requirement.envelope,
          bucket: stored.bucket,
          objectKey: stored.key,
          filename,
          mime: stored.mime,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        },
      }),
    );
  }

  async freeze(
    companyId: string,
    workspaceId: string,
    input: FreezeBidPackageInput,
    actor: BidActor,
  ): Promise<BidPackageSnapshot> {
    const snapshot = await this.get(companyId, workspaceId);
    if (snapshot.workspace.version !== input.expectedVersion) {
      throw new BidWorkspaceVersionConflictError();
    }
    if (snapshot.workspace.state !== 'review') {
      throw new BidPackageStateError('Package can be frozen only from review');
    }
    if (!snapshot.packageVersion || snapshot.packageVersion.status !== 'draft') {
      throw new BidPackageStateError('No draft package is ready to freeze');
    }
    const manifestFiles = snapshot.files.map((file) => {
      const requirement = snapshot.requirements.find(
        (candidate) => candidate.id === file.requirementId,
      );
      if (!requirement) {
        throw new BidPackageIntegrityError('Package file has no workspace requirement');
      }
      return {
        requirementId: requirement.id,
        requirementCode: requirement.code,
        envelope: file.envelope,
        filename: file.filename,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        objectKey: file.objectKey,
      } satisfies PackageFileForManifest;
    });
    assertPackageComplete(snapshot.requirements, manifestFiles);
    for (const file of snapshot.files) {
      const stored = await readStoredObject(this.storage, file.objectKey);
      if (stored.body.length !== file.sizeBytes || sha256(stored.body) !== file.sha256) {
        throw new BidPackageIntegrityError(
          `Stored package object failed integrity verification: ${file.filename}`,
        );
      }
    }
    const manifest = buildPackageManifest(
      workspaceId,
      snapshot.packageVersion.version,
      snapshot.requirements,
      manifestFiles,
    );
    return this.unwrap(
      await this.repository.freeze({
        companyId,
        workspaceId,
        packageVersionId: snapshot.packageVersion.id,
        expectedVersion: input.expectedVersion,
        manifest: manifest.manifest,
        manifestSha256: manifest.sha256,
        actor,
      }),
    );
  }

  private unwrap(result: BidPackageMutationResult): BidPackageSnapshot {
    if (result.kind === 'updated') return result.snapshot;
    if (result.kind === 'not_found') throw new BidWorkspaceNotFoundError();
    if (result.kind === 'version_conflict') {
      throw new BidWorkspaceVersionConflictError();
    }
    if (result.kind === 'invalid_state') {
      throw new BidPackageStateError(`Package mutation is forbidden in state: ${result.state}`);
    }
    if (result.kind === 'requirement_not_found') {
      throw new BidPackageStateError('Package requirement not found');
    }
    throw new BidPackageStateError('Draft package not found');
  }
}

async function readStoredObject(storage: ObjectStorage, key: string) {
  const object = await storage.getObject(key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    body: Buffer.concat(chunks),
    mime: object.mime,
  };
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
