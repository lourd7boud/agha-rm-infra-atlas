import { describe, expect, it } from 'vitest';
import {
  BidPackageIncompleteError,
  assertPackageComplete,
  buildPackageManifest,
} from './bid-package.domain';

const requirements = [
  { id: 'req-a', code: 'rc', label: 'Règlement', envelope: 'administrative' as const, required: true },
  { id: 'req-b', code: 'bpu', label: 'BPU', envelope: 'financial' as const, required: true },
  { id: 'req-c', code: 'memoire', label: 'Mémoire', envelope: 'technical' as const, required: false },
];

const files = [
  {
    requirementId: 'req-b',
    requirementCode: 'bpu',
    envelope: 'financial' as const,
    filename: 'BPU.pdf',
    mime: 'application/pdf',
    sizeBytes: 200,
    sha256: 'b'.repeat(64),
    objectKey: 'bid/w/p1/b.pdf',
  },
  {
    requirementId: 'req-a',
    requirementCode: 'rc',
    envelope: 'administrative' as const,
    filename: 'RC.pdf',
    mime: 'application/pdf',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    objectKey: 'bid/w/p1/a.pdf',
  },
];

describe('bid package manifest', () => {
  it('rejects a freeze when a mandatory requirement is missing', () => {
    expect(() => assertPackageComplete(requirements, files.slice(0, 1))).toThrow(
      new BidPackageIncompleteError(['rc']),
    );
  });

  it('does not require optional documents', () => {
    expect(() => assertPackageComplete(requirements, files)).not.toThrow();
  });

  it('produces the same digest regardless of query ordering', () => {
    const first = buildPackageManifest('workspace-1', 1, requirements, files);
    const second = buildPackageManifest(
      'workspace-1',
      1,
      [...requirements].reverse(),
      [...files].reverse(),
    );

    expect(first.sha256).toBe(second.sha256);
    expect(first.manifest.files.map((file) => file.requirementCode)).toEqual(['bpu', 'rc']);
    expect(first.canonicalJson).toBe(second.canonicalJson);
  });

  it('changes the digest when one recorded byte hash changes', () => {
    const original = buildPackageManifest('workspace-1', 1, requirements, files);
    const changed = buildPackageManifest('workspace-1', 1, requirements, [
      files[0]!,
      { ...files[1]!, sha256: 'c'.repeat(64) },
    ]);
    expect(changed.sha256).not.toBe(original.sha256);
  });

  it('changes the digest when the requirement contract changes', () => {
    const original = buildPackageManifest('workspace-1', 1, requirements, files);
    const changed = buildPackageManifest(
      'workspace-1',
      1,
      requirements.map((requirement) =>
        requirement.code === 'memoire'
          ? { ...requirement, required: true }
          : requirement,
      ),
      files,
    );
    expect(changed.sha256).not.toBe(original.sha256);
  });

  it('binds the operator-confirmed signature scope into the frozen digest', () => {
    const original = buildPackageManifest('workspace-1', 1, requirements, files);
    const changed = buildPackageManifest(
      'workspace-1',
      1,
      requirements.map((requirement) =>
        requirement.code === 'bpu'
          ? { ...requirement, requiresSignature: true }
          : requirement,
      ),
      files,
    );

    expect(changed.sha256).not.toBe(original.sha256);
  });
});
