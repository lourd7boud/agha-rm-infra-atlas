import { createHash } from 'node:crypto';
import type { BidPackageEnvelope } from '@atlas/contracts';

export interface PackageRequirementForFreeze {
  id: string;
  code: string;
  label: string;
  envelope: BidPackageEnvelope;
  required: boolean;
  requiresSignature?: boolean;
}

export interface PackageFileForManifest {
  requirementId: string;
  requirementCode: string;
  envelope: BidPackageEnvelope;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
}

export class BidPackageIncompleteError extends Error {
  constructor(readonly missingCodes: readonly string[]) {
    super(`Missing required package documents: ${missingCodes.join(', ')}`);
    this.name = 'BidPackageIncompleteError';
  }
}

export class BidPackageDuplicateRequirementError extends Error {
  constructor(readonly requirementCode: string) {
    super(`Package contains more than one file for requirement: ${requirementCode}`);
    this.name = 'BidPackageDuplicateRequirementError';
  }
}

export function assertPackageComplete(
  requirements: readonly PackageRequirementForFreeze[],
  files: readonly PackageFileForManifest[],
): void {
  const filesByRequirement = new Map<string, number>();
  for (const file of files) {
    filesByRequirement.set(
      file.requirementId,
      (filesByRequirement.get(file.requirementId) ?? 0) + 1,
    );
  }
  for (const requirement of requirements) {
    if ((filesByRequirement.get(requirement.id) ?? 0) > 1) {
      throw new BidPackageDuplicateRequirementError(requirement.code);
    }
  }
  const missingCodes = requirements
    .filter(
      (requirement) =>
        requirement.required && !filesByRequirement.has(requirement.id),
    )
    .map((requirement) => requirement.code)
    .sort();
  if (missingCodes.length > 0) throw new BidPackageIncompleteError(missingCodes);
}

export function buildPackageManifest(
  workspaceId: string,
  version: number,
  requirements: readonly PackageRequirementForFreeze[],
  files: readonly PackageFileForManifest[],
) {
  const orderedRequirements = [...requirements]
    .sort((left, right) => left.code.localeCompare(right.code, 'en'))
    .map((requirement) => ({
      id: requirement.id,
      code: requirement.code,
      label: requirement.label,
      envelope: requirement.envelope,
      required: requirement.required,
      requiresSignature: requirement.requiresSignature ?? false,
    }));
  const orderedFiles = [...files]
    .sort(
      (left, right) =>
        left.requirementCode.localeCompare(right.requirementCode, 'en') ||
        left.objectKey.localeCompare(right.objectKey, 'en'),
    )
    .map((file) => ({
      requirementId: file.requirementId,
      requirementCode: file.requirementCode,
      envelope: file.envelope,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      objectKey: file.objectKey,
    }));
  const manifest = {
    schema: 'atlas.bid-package-manifest.v1' as const,
    workspaceId,
    version,
    requirements: orderedRequirements,
    files: orderedFiles,
  };
  const canonicalJson = JSON.stringify(manifest);
  return {
    manifest,
    canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  };
}
