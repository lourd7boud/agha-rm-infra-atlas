import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type {
  BidPackageEnvelope,
  BidPackageRequirementInput,
  BidWorkspaceState,
} from '@atlas/contracts';
import type { BidActor } from './bid.repository';
import type { Db } from '../../db/client';
import {
  bidEvents,
  bidPackageFiles,
  bidPackageRequirements,
  bidPackageVersions,
  bidWorkspaces,
} from '../../db/schema/bid';

export interface BidPackageWorkspaceRecord {
  id: string;
  companyId: string;
  state: BidWorkspaceState;
  version: number;
  currentPackageVersion: number | null;
}

export interface BidPackageRequirementRecord extends BidPackageRequirementInput {
  id: string;
  workspaceId: string;
  source: string;
}

export interface BidPackageVersionRecord {
  id: string;
  workspaceId: string;
  version: number;
  status: 'draft' | 'frozen' | 'superseded';
  manifest: unknown | null;
  manifestSha256: string | null;
  createdBySub: string;
  frozenBySub: string | null;
  frozenAt: Date | null;
}

export interface BidPackageFileRecord {
  id: string;
  packageVersionId: string;
  requirementId: string;
  vaultDocumentId: string | null;
  documentKind: string;
  envelope: BidPackageEnvelope;
  bucket: string;
  objectKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export interface BidPackageSnapshot {
  workspace: BidPackageWorkspaceRecord;
  requirements: BidPackageRequirementRecord[];
  packageVersion: BidPackageVersionRecord | null;
  files: BidPackageFileRecord[];
}

export interface BidPackageAuditEvent {
  type: string;
  actorSub: string;
  metadata?: Record<string, unknown>;
}

export type BidPackageMutationResult =
  | { kind: 'updated'; snapshot: BidPackageSnapshot }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'invalid_state'; state: BidWorkspaceState }
  | { kind: 'requirement_not_found' }
  | { kind: 'package_not_found' };

export interface DefineRequirementsCommand {
  companyId: string;
  workspaceId: string;
  requirements: readonly BidPackageRequirementInput[];
  expectedVersion: number;
  actor: BidActor;
}

export interface AttachPackageFileCommand {
  companyId: string;
  workspaceId: string;
  requirementId: string;
  expectedVersion: number;
  actor: BidActor;
  file: Omit<BidPackageFileRecord, 'id' | 'packageVersionId' | 'requirementId'>;
}

export interface FreezePackageCommand {
  companyId: string;
  workspaceId: string;
  packageVersionId: string;
  expectedVersion: number;
  manifest: unknown;
  manifestSha256: string;
  actor: BidActor;
}

export const BID_PACKAGE_REPOSITORY = Symbol('BID_PACKAGE_REPOSITORY');

export interface BidPackageRepository {
  findSnapshot(companyId: string, workspaceId: string): Promise<BidPackageSnapshot | null>;
  defineRequirements(command: DefineRequirementsCommand): Promise<BidPackageMutationResult>;
  attachFile(command: AttachPackageFileCommand): Promise<BidPackageMutationResult>;
  freeze(command: FreezePackageCommand): Promise<BidPackageMutationResult>;
}

/** Behavioral test double mirroring optimistic and evidence-state invariants. */
export class InMemoryBidPackageRepository implements BidPackageRepository {
  private readonly workspaces = new Map<string, BidPackageWorkspaceRecord>();
  private readonly requirements = new Map<string, BidPackageRequirementRecord[]>();
  private readonly versions = new Map<string, BidPackageVersionRecord[]>();
  private readonly files = new Map<string, BidPackageFileRecord[]>();
  private readonly events = new Map<string, BidPackageAuditEvent[]>();

  seedWorkspace(workspace: BidPackageWorkspaceRecord): void {
    this.workspaces.set(workspace.id, structuredClone(workspace));
  }

  async findSnapshot(
    companyId: string,
    workspaceId: string,
  ): Promise<BidPackageSnapshot | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.companyId !== companyId) return null;
    const versions = this.versions.get(workspaceId) ?? [];
    const packageVersion = workspace.currentPackageVersion
      ? versions.find((candidate) => candidate.version === workspace.currentPackageVersion) ?? null
      : null;
    return structuredClone({
      workspace,
      requirements: this.requirements.get(workspaceId) ?? [],
      packageVersion,
      files: packageVersion ? this.files.get(packageVersion.id) ?? [] : [],
    });
  }

  async defineRequirements(
    command: DefineRequirementsCommand,
  ): Promise<BidPackageMutationResult> {
    const workspace = this.workspaces.get(command.workspaceId);
    const failure = this.guard(workspace, command.companyId, command.expectedVersion);
    if (failure) return failure;
    if (workspace!.state !== 'assembling' && workspace!.state !== 'review') {
      return { kind: 'invalid_state', state: workspace!.state };
    }
    const current = this.requirements.get(workspace!.id) ?? [];
    const byCode = new Map(current.map((requirement) => [requirement.code, requirement]));
    for (const input of command.requirements) {
      const existing = byCode.get(input.code);
      byCode.set(input.code, {
        ...input,
        id: existing?.id ?? randomUUID(),
        workspaceId: workspace!.id,
        source: 'operator',
      });
    }
    this.requirements.set(workspace!.id, [...byCode.values()]);
    workspace!.version += 1;
    this.appendEvent(workspace!.id, {
      type: 'requirements_defined',
      actorSub: command.actor.sub,
      metadata: { codes: command.requirements.map((requirement) => requirement.code) },
    });
    return { kind: 'updated', snapshot: (await this.findSnapshot(command.companyId, workspace!.id))! };
  }

  async attachFile(command: AttachPackageFileCommand): Promise<BidPackageMutationResult> {
    const workspace = this.workspaces.get(command.workspaceId);
    const failure = this.guard(workspace, command.companyId, command.expectedVersion);
    if (failure) return failure;
    if (workspace!.state !== 'assembling' && workspace!.state !== 'review') {
      return { kind: 'invalid_state', state: workspace!.state };
    }
    const requirement = (this.requirements.get(workspace!.id) ?? []).find(
      (candidate) => candidate.id === command.requirementId,
    );
    if (!requirement) return { kind: 'requirement_not_found' };
    let packageVersion = (this.versions.get(workspace!.id) ?? []).find(
      (candidate) => candidate.version === workspace!.currentPackageVersion,
    );
    if (!packageVersion) {
      packageVersion = {
        id: randomUUID(),
        workspaceId: workspace!.id,
        version: 1,
        status: 'draft',
        manifest: null,
        manifestSha256: null,
        createdBySub: command.actor.sub,
        frozenBySub: null,
        frozenAt: null,
      };
      this.versions.set(workspace!.id, [packageVersion]);
      workspace!.currentPackageVersion = 1;
    }
    if (packageVersion.status !== 'draft') {
      return { kind: 'invalid_state', state: workspace!.state };
    }
    const currentFiles = this.files.get(packageVersion.id) ?? [];
    const record: BidPackageFileRecord = {
      ...command.file,
      id: randomUUID(),
      packageVersionId: packageVersion.id,
      requirementId: requirement.id,
    };
    this.files.set(packageVersion.id, [
      ...currentFiles.filter((file) => file.requirementId !== requirement.id),
      record,
    ]);
    workspace!.version += 1;
    this.appendEvent(workspace!.id, {
      type: 'package_file_attached',
      actorSub: command.actor.sub,
      metadata: { requirementCode: requirement.code, sha256: record.sha256 },
    });
    return { kind: 'updated', snapshot: (await this.findSnapshot(command.companyId, workspace!.id))! };
  }

  async freeze(command: FreezePackageCommand): Promise<BidPackageMutationResult> {
    const workspace = this.workspaces.get(command.workspaceId);
    const failure = this.guard(workspace, command.companyId, command.expectedVersion);
    if (failure) return failure;
    if (workspace!.state !== 'review') {
      return { kind: 'invalid_state', state: workspace!.state };
    }
    const packageVersion = (this.versions.get(workspace!.id) ?? []).find(
      (candidate) => candidate.id === command.packageVersionId,
    );
    if (!packageVersion || packageVersion.status !== 'draft') {
      return { kind: 'package_not_found' };
    }
    packageVersion.status = 'frozen';
    packageVersion.manifest = structuredClone(command.manifest);
    packageVersion.manifestSha256 = command.manifestSha256;
    packageVersion.frozenBySub = command.actor.sub;
    packageVersion.frozenAt = new Date();
    workspace!.state = 'frozen';
    workspace!.version += 1;
    this.appendEvent(workspace!.id, {
      type: 'package_frozen',
      actorSub: command.actor.sub,
      metadata: {
        packageVersion: packageVersion.version,
        manifestSha256: command.manifestSha256,
      },
    });
    return { kind: 'updated', snapshot: (await this.findSnapshot(command.companyId, workspace!.id))! };
  }

  eventsFor(workspaceId: string): readonly BidPackageAuditEvent[] {
    return structuredClone(this.events.get(workspaceId) ?? []);
  }

  private guard(
    workspace: BidPackageWorkspaceRecord | undefined,
    companyId: string,
    expectedVersion: number,
  ): Exclude<BidPackageMutationResult, { kind: 'updated' }> | null {
    if (!workspace || workspace.companyId !== companyId) return { kind: 'not_found' };
    if (workspace.version !== expectedVersion) return { kind: 'version_conflict' };
    return null;
  }

  private appendEvent(workspaceId: string, event: BidPackageAuditEvent): void {
    this.events.set(workspaceId, [...(this.events.get(workspaceId) ?? []), event]);
  }
}

export class DrizzleBidPackageRepository implements BidPackageRepository {
  constructor(private readonly db: Db) {}

  async findSnapshot(
    companyId: string,
    workspaceId: string,
  ): Promise<BidPackageSnapshot | null> {
    const [workspace] = await this.db
      .select()
      .from(bidWorkspaces)
      .where(
        and(
          eq(bidWorkspaces.companyId, companyId),
          eq(bidWorkspaces.id, workspaceId),
        ),
      )
      .limit(1);
    if (!workspace) return null;
    const requirements = await this.db
      .select()
      .from(bidPackageRequirements)
      .where(eq(bidPackageRequirements.workspaceId, workspaceId));
    let packageVersion: typeof bidPackageVersions.$inferSelect | undefined;
    let files: (typeof bidPackageFiles.$inferSelect)[] = [];
    if (workspace.currentPackageVersion !== null) {
      [packageVersion] = await this.db
        .select()
        .from(bidPackageVersions)
        .where(
          and(
            eq(bidPackageVersions.workspaceId, workspaceId),
            eq(bidPackageVersions.version, workspace.currentPackageVersion),
          ),
        )
        .limit(1);
      if (packageVersion) {
        files = await this.db
          .select()
          .from(bidPackageFiles)
          .where(eq(bidPackageFiles.packageVersionId, packageVersion.id));
      }
    }
    return {
      workspace: mapWorkspace(workspace),
      requirements: requirements.map(mapRequirement),
      packageVersion: packageVersion ? mapPackageVersion(packageVersion) : null,
      files: files.map(mapPackageFile),
    };
  }

  async defineRequirements(
    command: DefineRequirementsCommand,
  ): Promise<BidPackageMutationResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(
          and(
            eq(bidWorkspaces.companyId, command.companyId),
            eq(bidWorkspaces.id, command.workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      if (workspace.version !== command.expectedVersion) {
        return { kind: 'version_conflict' as const };
      }
      if (workspace.state !== 'assembling' && workspace.state !== 'review') {
        return { kind: 'invalid_state' as const, state: workspace.state as BidWorkspaceState };
      }
      for (const requirement of command.requirements) {
        await tx
          .insert(bidPackageRequirements)
          .values({
            workspaceId: workspace.id,
            code: requirement.code,
            label: requirement.label,
            envelope: requirement.envelope,
            required: requirement.required,
            requiresSignature: requirement.requiresSignature ?? false,
            source: 'operator',
          })
          .onConflictDoUpdate({
            target: [bidPackageRequirements.workspaceId, bidPackageRequirements.code],
            set: {
              label: requirement.label,
              envelope: requirement.envelope,
              required: requirement.required,
              requiresSignature: requirement.requiresSignature ?? false,
              updatedAt: new Date(),
            },
          });
      }
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({ version: workspace.version + 1, updatedAt: new Date() })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'requirements_defined',
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        metadata: { codes: command.requirements.map((requirement) => requirement.code) },
      });
      return { kind: 'committed' as const };
    });
    return this.hydrateOutcome(outcome, command.companyId, command.workspaceId);
  }

  async attachFile(command: AttachPackageFileCommand): Promise<BidPackageMutationResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(
          and(
            eq(bidWorkspaces.companyId, command.companyId),
            eq(bidWorkspaces.id, command.workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      if (workspace.version !== command.expectedVersion) {
        return { kind: 'version_conflict' as const };
      }
      if (workspace.state !== 'assembling' && workspace.state !== 'review') {
        return { kind: 'invalid_state' as const, state: workspace.state as BidWorkspaceState };
      }
      const [requirement] = await tx
        .select()
        .from(bidPackageRequirements)
        .where(
          and(
            eq(bidPackageRequirements.workspaceId, workspace.id),
            eq(bidPackageRequirements.id, command.requirementId),
          ),
        )
        .limit(1);
      if (!requirement) return { kind: 'requirement_not_found' as const };

      let packageVersion: typeof bidPackageVersions.$inferSelect | undefined;
      if (workspace.currentPackageVersion !== null) {
        [packageVersion] = await tx
          .select()
          .from(bidPackageVersions)
          .where(
            and(
              eq(bidPackageVersions.workspaceId, workspace.id),
              eq(bidPackageVersions.version, workspace.currentPackageVersion),
            ),
          )
          .limit(1);
      }
      if (packageVersion && packageVersion.status !== 'draft') {
        return { kind: 'invalid_state' as const, state: workspace.state as BidWorkspaceState };
      }
      if (!packageVersion) {
        [packageVersion] = await tx
          .insert(bidPackageVersions)
          .values({
            workspaceId: workspace.id,
            version: 1,
            createdBySub: command.actor.sub,
          })
          .returning();
      }
      if (!packageVersion) return { kind: 'package_not_found' as const };

      await tx
        .insert(bidPackageFiles)
        .values({
          packageVersionId: packageVersion.id,
          requirementId: requirement.id,
          vaultDocumentId: command.file.vaultDocumentId,
          documentKind: command.file.documentKind,
          envelope: requirement.envelope,
          bucket: command.file.bucket,
          objectKey: command.file.objectKey,
          filename: command.file.filename,
          mime: command.file.mime,
          sizeBytes: command.file.sizeBytes,
          sha256: command.file.sha256,
        })
        .onConflictDoUpdate({
          target: [bidPackageFiles.packageVersionId, bidPackageFiles.requirementId],
          set: {
            vaultDocumentId: command.file.vaultDocumentId,
            documentKind: command.file.documentKind,
            envelope: requirement.envelope,
            bucket: command.file.bucket,
            objectKey: command.file.objectKey,
            filename: command.file.filename,
            mime: command.file.mime,
            sizeBytes: command.file.sizeBytes,
            sha256: command.file.sha256,
          },
        });
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({
          currentPackageVersion: packageVersion.version,
          version: workspace.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'package_file_attached',
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        metadata: {
          requirementCode: requirement.code,
          sha256: command.file.sha256,
        },
      });
      return { kind: 'committed' as const };
    });
    return this.hydrateOutcome(outcome, command.companyId, command.workspaceId);
  }

  async freeze(command: FreezePackageCommand): Promise<BidPackageMutationResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(
          and(
            eq(bidWorkspaces.companyId, command.companyId),
            eq(bidWorkspaces.id, command.workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      if (workspace.version !== command.expectedVersion) {
        return { kind: 'version_conflict' as const };
      }
      if (workspace.state !== 'review') {
        return { kind: 'invalid_state' as const, state: workspace.state as BidWorkspaceState };
      }
      const [frozen] = await tx
        .update(bidPackageVersions)
        .set({
          status: 'frozen',
          manifest: command.manifest,
          manifestSha256: command.manifestSha256,
          frozenBySub: command.actor.sub,
          frozenAt: new Date(),
        })
        .where(
          and(
            eq(bidPackageVersions.id, command.packageVersionId),
            eq(bidPackageVersions.workspaceId, workspace.id),
            eq(bidPackageVersions.status, 'draft'),
          ),
        )
        .returning();
      if (!frozen) return { kind: 'package_not_found' as const };
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({ state: 'frozen', version: workspace.version + 1, updatedAt: new Date() })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'package_frozen',
        fromState: 'review',
        toState: 'frozen',
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        metadata: {
          packageVersion: frozen.version,
          manifestSha256: command.manifestSha256,
        },
      });
      return { kind: 'committed' as const };
    });
    return this.hydrateOutcome(outcome, command.companyId, command.workspaceId);
  }

  private async hydrateOutcome(
    outcome: Exclude<BidPackageMutationResult, { kind: 'updated' }> | { kind: 'committed' },
    companyId: string,
    workspaceId: string,
  ): Promise<BidPackageMutationResult> {
    if (outcome.kind !== 'committed') return outcome;
    const snapshot = await this.findSnapshot(companyId, workspaceId);
    return snapshot ? { kind: 'updated', snapshot } : { kind: 'not_found' };
  }
}

type WorkspaceRow = typeof bidWorkspaces.$inferSelect;

function mapWorkspace(row: WorkspaceRow): BidPackageWorkspaceRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    state: row.state as BidWorkspaceState,
    version: row.version,
    currentPackageVersion: row.currentPackageVersion,
  };
}

function mapRequirement(
  row: typeof bidPackageRequirements.$inferSelect,
): BidPackageRequirementRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    code: row.code,
    label: row.label,
    envelope: row.envelope as BidPackageEnvelope,
    required: row.required,
    requiresSignature: row.requiresSignature,
    source: row.source,
  };
}

function mapPackageVersion(
  row: typeof bidPackageVersions.$inferSelect,
): BidPackageVersionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    version: row.version,
    status: row.status as BidPackageVersionRecord['status'],
    manifest: row.manifest,
    manifestSha256: row.manifestSha256,
    createdBySub: row.createdBySub,
    frozenBySub: row.frozenBySub,
    frozenAt: row.frozenAt,
  };
}

function mapPackageFile(
  row: typeof bidPackageFiles.$inferSelect,
): BidPackageFileRecord {
  return {
    id: row.id,
    packageVersionId: row.packageVersionId,
    requirementId: row.requirementId,
    vaultDocumentId: row.vaultDocumentId,
    documentKind: row.documentKind,
    envelope: row.envelope as BidPackageEnvelope,
    bucket: row.bucket,
    objectKey: row.objectKey,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
  };
}
