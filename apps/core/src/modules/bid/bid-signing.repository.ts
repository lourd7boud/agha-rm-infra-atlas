import { randomUUID } from 'node:crypto';
import type { BidWorkspaceState } from '@atlas/contracts';
import { and, eq, inArray, lte, or } from 'drizzle-orm';
import type { BidActor } from './bid.repository';
import type { Db } from '../../db/client';
import {
  bidEvents,
  bidPackageFiles,
  bidPackageRequirements,
  bidPackageVersions,
  bidSigningArtifacts,
  bidSigningArtifactUploads,
  bidSigningTasks,
  bidWorkspaces,
} from '../../db/schema/bid';

export type BidSigningTaskState =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BidSigningWorkspaceTarget {
  id: string;
  companyId: string;
  state: BidWorkspaceState;
  version: number;
  currentPackageVersion: number | null;
}

export interface BidSigningPackageTarget {
  id: string;
  version: number;
  status: 'draft' | 'frozen' | 'superseded';
  manifestSha256: string | null;
}

export interface BidSigningInputFile {
  id: string;
  requirementId: string;
  requiresSignature: boolean;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
}

export interface BidSigningTargetSeed {
  workspace: BidSigningWorkspaceTarget;
  packageVersion: BidSigningPackageTarget;
  files: BidSigningInputFile[];
}

export interface BidSigningTaskRecord {
  id: string;
  workspaceId: string;
  packageVersionId: string;
  manifestSha256: string;
  state: BidSigningTaskState;
  signerSub: string;
  requestedBySub: string;
  requestedByName: string;
  pairingSecretSha256: string | null;
  pairingExpiresAt: Date | null;
  claimedByDeviceId: string | null;
  claimedByDeviceName: string | null;
  claimedAt: Date | null;
  leaseSecretSha256: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BidSigningTaskSnapshot {
  task: BidSigningTaskRecord;
  files: BidSigningInputFile[];
}

export interface BidSigningArtifactRecord {
  id: string;
  taskId: string;
  packageFileId: string;
  bucket: string;
  objectKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  certificateThumbprint: string;
  certificateSubject: string;
  signedAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

export type BidSigningMutationResult =
  | { kind: 'created'; snapshot: BidSigningTaskSnapshot }
  | { kind: 'claimed'; snapshot: BidSigningTaskSnapshot }
  | { kind: 'authorized'; snapshot: BidSigningTaskSnapshot }
  | { kind: 'artifact_recorded'; artifact: BidSigningArtifactRecord }
  | { kind: 'cancelled'; snapshot: BidSigningTaskSnapshot }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'invalid_state'; reason: string }
  | { kind: 'secret_mismatch' }
  | { kind: 'expired' };

export interface RecordSigningArtifactCommand {
  reservationId: string;
  taskId: string;
  packageFileId: string;
  claimantSub: string;
  leaseSecretSha256: string;
  now: Date;
  artifact: Omit<
    BidSigningArtifactRecord,
    'id' | 'taskId' | 'packageFileId' | 'verifiedAt' | 'createdAt'
  >;
}

export interface BidSigningUploadReservation {
  id: string;
  taskId: string;
  packageFileId: string;
  objectKey: string;
  sha256: string;
  state: 'reserved' | 'cleanup_pending' | 'finalized' | 'abandoned';
  expiresAt: Date;
}

export interface ReserveSigningArtifactUploadCommand {
  taskId: string;
  packageFileId: string;
  claimantSub: string;
  leaseSecretSha256: string;
  objectKey: string;
  sha256: string;
  expiresAt: Date;
  now: Date;
}

export type ReserveSigningArtifactUploadResult =
  | { kind: 'reserved'; reservation: BidSigningUploadReservation }
  | { kind: 'artifact_recorded'; artifact: BidSigningArtifactRecord }
  | { kind: 'not_found' | 'secret_mismatch' | 'expired' }
  | { kind: 'invalid_state'; reason: string };

export interface CancelSigningTaskCommand {
  companyId: string;
  workspaceId: string;
  taskId: string;
  expectedVersion: number;
  actor: BidActor;
  reason: string;
  now: Date;
}

export interface CreateSigningTaskCommand {
  companyId: string;
  workspaceId: string;
  signerSub: string;
  expectedVersion: number;
  actor: BidActor;
  pairingSecretSha256: string;
  pairingExpiresAt: Date;
  now: Date;
}

export interface ClaimSigningTaskCommand {
  taskId: string;
  pairingSecretSha256: string;
  deviceId: string;
  deviceName: string;
  claimantSub: string;
  claimantName: string;
  leaseSecretSha256: string;
  leaseExpiresAt: Date;
  now: Date;
}

export interface AuthorizeSigningLeaseCommand {
  taskId: string;
  claimantSub: string;
  leaseSecretSha256: string;
  now: Date;
}

export const BID_SIGNING_REPOSITORY = Symbol('BID_SIGNING_REPOSITORY');

export interface BidSigningRepository {
  expireAllStale(now: Date, limit: number): Promise<number>;
  expireStale(companyId: string, workspaceId: string, now: Date): Promise<boolean>;
  findActive(
    companyId: string,
    workspaceId: string,
  ): Promise<BidSigningTaskSnapshot | null>;
  create(command: CreateSigningTaskCommand): Promise<BidSigningMutationResult>;
  claim(command: ClaimSigningTaskCommand): Promise<BidSigningMutationResult>;
  authorizeLease(
    command: AuthorizeSigningLeaseCommand,
  ): Promise<BidSigningMutationResult>;
  reserveArtifactUpload(
    command: ReserveSigningArtifactUploadCommand,
  ): Promise<ReserveSigningArtifactUploadResult>;
  claimExpiredUploads(now: Date, limit: number): Promise<BidSigningUploadReservation[]>;
  abandonUpload(reservationId: string, now: Date, error?: string): Promise<void>;
  recordArtifact(
    command: RecordSigningArtifactCommand,
  ): Promise<BidSigningMutationResult>;
  cancel(command: CancelSigningTaskCommand): Promise<BidSigningMutationResult>;
}

/** Deterministic behavioral double; PostgreSQL implementation follows the same states. */
export class InMemoryBidSigningRepository implements BidSigningRepository {
  private readonly targets = new Map<string, BidSigningTargetSeed>();
  private readonly tasks = new Map<string, BidSigningTaskRecord>();
  private readonly artifacts = new Map<string, BidSigningArtifactRecord>();
  private readonly uploads = new Map<string, BidSigningUploadReservation>();

  seedTarget(seed: BidSigningTargetSeed): void {
    this.targets.set(seed.workspace.id, structuredClone(seed));
  }

  async expireAllStale(now: Date, limit: number): Promise<number> {
    let expired = 0;
    for (const target of this.targets.values()) {
      if (expired >= limit) break;
      if (await this.expireStale(target.workspace.companyId, target.workspace.id, now)) {
        expired += 1;
      }
    }
    return expired;
  }

  async expireStale(
    companyId: string,
    workspaceId: string,
    now: Date,
  ): Promise<boolean> {
    const target = this.targets.get(workspaceId);
    if (!target || target.workspace.companyId !== companyId) return false;
    const task = [...this.tasks.values()].find(
      (item) =>
        item.workspaceId === workspaceId &&
        (item.state === 'pending' || item.state === 'claimed'),
    );
    if (!task) return false;
    const deadline = task.state === 'pending' ? task.pairingExpiresAt : task.leaseExpiresAt;
    if (!deadline || deadline > now) return false;
    task.state = 'cancelled';
    task.pairingSecretSha256 = null;
    task.pairingExpiresAt = null;
    task.leaseSecretSha256 = null;
    task.leaseExpiresAt = null;
    task.updatedAt = now;
    target.workspace.state = 'frozen';
    target.workspace.version += 1;
    return true;
  }

  async findActive(
    companyId: string,
    workspaceId: string,
  ): Promise<BidSigningTaskSnapshot | null> {
    const target = this.targets.get(workspaceId);
    if (!target || target.workspace.companyId !== companyId) return null;
    const task = [...this.tasks.values()].find(
      (item) =>
        item.workspaceId === workspaceId &&
        (item.state === 'pending' || item.state === 'claimed'),
    );
    return task
      ? structuredClone({
          task,
          files: target.files.filter((file) => file.requiresSignature),
        })
      : null;
  }

  async create(command: CreateSigningTaskCommand): Promise<BidSigningMutationResult> {
    const target = this.targets.get(command.workspaceId);
    if (!target || target.workspace.companyId !== command.companyId) {
      return { kind: 'not_found' };
    }
    if (target.workspace.version !== command.expectedVersion) {
      return { kind: 'version_conflict' };
    }
    if (target.workspace.state !== 'frozen') {
      return { kind: 'invalid_state', reason: 'workspace_not_frozen' };
    }
    if (
      target.packageVersion.status !== 'frozen' ||
      target.packageVersion.version !== target.workspace.currentPackageVersion ||
      !target.packageVersion.manifestSha256
    ) {
      return { kind: 'invalid_state', reason: 'package_not_frozen' };
    }
    if ([...this.tasks.values()].some((task) =>
      task.workspaceId === command.workspaceId &&
      (task.state === 'pending' || task.state === 'claimed'),
    )) {
      return { kind: 'invalid_state', reason: 'active_task_exists' };
    }
    const files = target.files.filter((file) => file.requiresSignature);
    if (files.length === 0) {
      return { kind: 'invalid_state', reason: 'no_signature_files' };
    }
    const task: BidSigningTaskRecord = {
      id: randomUUID(),
      workspaceId: target.workspace.id,
      packageVersionId: target.packageVersion.id,
      manifestSha256: target.packageVersion.manifestSha256,
      state: 'pending',
      signerSub: command.signerSub,
      requestedBySub: command.actor.sub,
      requestedByName: command.actor.name,
      pairingSecretSha256: command.pairingSecretSha256,
      pairingExpiresAt: command.pairingExpiresAt,
      claimedByDeviceId: null,
      claimedByDeviceName: null,
      claimedAt: null,
      leaseSecretSha256: null,
      leaseExpiresAt: null,
      createdAt: command.now,
      updatedAt: command.now,
    };
    this.tasks.set(task.id, task);
    target.workspace.state = 'awaiting_signature';
    target.workspace.version += 1;
    return { kind: 'created', snapshot: structuredClone({ task, files }) };
  }

  async claim(command: ClaimSigningTaskCommand): Promise<BidSigningMutationResult> {
    const task = this.tasks.get(command.taskId);
    if (!task) return { kind: 'not_found' };
    if (task.state !== 'pending') return { kind: 'invalid_state', reason: 'not_pending' };
    if (task.signerSub !== command.claimantSub) return { kind: 'secret_mismatch' };
    if (!task.pairingExpiresAt || task.pairingExpiresAt <= command.now) {
      const target = this.targets.get(task.workspaceId);
      task.state = 'cancelled';
      task.pairingSecretSha256 = null;
      task.pairingExpiresAt = null;
      task.updatedAt = command.now;
      if (target) {
        target.workspace.state = 'frozen';
        target.workspace.version += 1;
      }
      return { kind: 'expired' };
    }
    if (task.pairingSecretSha256 !== command.pairingSecretSha256) {
      return { kind: 'secret_mismatch' };
    }
    const target = this.targets.get(task.workspaceId);
    if (!target || target.workspace.state !== 'awaiting_signature') {
      return { kind: 'invalid_state', reason: 'workspace_not_waiting' };
    }
    task.state = 'claimed';
    task.pairingSecretSha256 = null;
    task.pairingExpiresAt = null;
    task.claimedByDeviceId = command.deviceId;
    task.claimedByDeviceName = command.deviceName;
    task.claimedAt = command.now;
    task.leaseSecretSha256 = command.leaseSecretSha256;
    task.leaseExpiresAt = command.leaseExpiresAt;
    task.updatedAt = command.now;
    target.workspace.state = 'signing';
    target.workspace.version += 1;
    return {
      kind: 'claimed',
      snapshot: structuredClone({
        task,
        files: target.files.filter((file) => file.requiresSignature),
      }),
    };
  }

  async authorizeLease(
    command: AuthorizeSigningLeaseCommand,
  ): Promise<BidSigningMutationResult> {
    const task = this.tasks.get(command.taskId);
    if (!task) return { kind: 'not_found' };
    if (task.state !== 'claimed') return { kind: 'invalid_state', reason: 'not_claimed' };
    if (!task.leaseExpiresAt || task.leaseExpiresAt <= command.now) {
      const target = this.targets.get(task.workspaceId);
      if (target) {
        task.state = 'cancelled';
        task.leaseSecretSha256 = null;
        task.leaseExpiresAt = null;
        task.updatedAt = command.now;
        target.workspace.state = 'frozen';
        target.workspace.version += 1;
      }
      return { kind: 'expired' };
    }
    if (task.signerSub !== command.claimantSub) return { kind: 'secret_mismatch' };
    if (task.leaseSecretSha256 !== command.leaseSecretSha256) {
      return { kind: 'secret_mismatch' };
    }
    const target = this.targets.get(task.workspaceId);
    if (!target) return { kind: 'not_found' };
    return {
      kind: 'authorized',
      snapshot: structuredClone({
        task,
        files: target.files.filter((file) => file.requiresSignature),
      }),
    };
  }

  async recordArtifact(
    command: RecordSigningArtifactCommand,
  ): Promise<BidSigningMutationResult> {
    const authorized = await this.authorizeLease({
      taskId: command.taskId,
      claimantSub: command.claimantSub,
      leaseSecretSha256: command.leaseSecretSha256,
      now: command.now,
    });
    if (authorized.kind !== 'authorized') {
      if (authorized.kind === 'invalid_state') return authorized;
      if (
        authorized.kind === 'not_found' ||
        authorized.kind === 'secret_mismatch' ||
        authorized.kind === 'expired'
      ) return authorized;
      return { kind: 'invalid_state', reason: 'unexpected_authorization_result' };
    }
    if (!authorized.snapshot.files.some((file) => file.id === command.packageFileId)) {
      return { kind: 'not_found' };
    }
    const reservation = this.uploads.get(command.reservationId);
    if (
      !reservation ||
      reservation.state !== 'reserved' ||
      reservation.taskId !== command.taskId ||
      reservation.packageFileId !== command.packageFileId ||
      reservation.objectKey !== command.artifact.objectKey ||
      reservation.sha256 !== command.artifact.sha256
    ) {
      return { kind: 'invalid_state', reason: 'upload_reservation_mismatch' };
    }
    const key = `${command.taskId}:${command.packageFileId}`;
    const existing = this.artifacts.get(key);
    if (existing) {
      return existing.sha256 === command.artifact.sha256
        ? { kind: 'artifact_recorded', artifact: structuredClone(existing) }
        : { kind: 'invalid_state', reason: 'artifact_conflict' };
    }
    const artifact: BidSigningArtifactRecord = {
      ...command.artifact,
      id: randomUUID(),
      taskId: command.taskId,
      packageFileId: command.packageFileId,
      verifiedAt: null,
      createdAt: command.now,
    };
    this.artifacts.set(key, artifact);
    reservation.state = 'finalized';
    return { kind: 'artifact_recorded', artifact: structuredClone(artifact) };
  }

  async reserveArtifactUpload(
    command: ReserveSigningArtifactUploadCommand,
  ): Promise<ReserveSigningArtifactUploadResult> {
    const authorized = await this.authorizeLease({
      taskId: command.taskId,
      claimantSub: command.claimantSub,
      leaseSecretSha256: command.leaseSecretSha256,
      now: command.now,
    });
    if (authorized.kind !== 'authorized') {
      if (authorized.kind === 'invalid_state') return authorized;
      if (
        authorized.kind === 'not_found' ||
        authorized.kind === 'secret_mismatch' ||
        authorized.kind === 'expired'
      ) return authorized;
      return { kind: 'invalid_state', reason: 'unexpected_authorization_result' };
    }
    if (!authorized.snapshot.files.some((file) => file.id === command.packageFileId)) {
      return { kind: 'not_found' };
    }
    const artifact = this.artifacts.get(`${command.taskId}:${command.packageFileId}`);
    if (artifact) {
      return artifact.sha256 === command.sha256
        ? { kind: 'artifact_recorded', artifact: structuredClone(artifact) }
        : { kind: 'invalid_state', reason: 'artifact_conflict' };
    }
    const existing = [...this.uploads.values()].find(
      (item) => item.objectKey === command.objectKey,
    );
    if (existing?.state === 'reserved') {
      return { kind: 'reserved', reservation: structuredClone(existing) };
    }
    if (existing?.state === 'abandoned') {
      existing.state = 'reserved';
      existing.expiresAt = command.expiresAt;
      return { kind: 'reserved', reservation: structuredClone(existing) };
    }
    if (existing) return { kind: 'invalid_state', reason: 'upload_cleanup_in_progress' };
    const reservation: BidSigningUploadReservation = {
      id: randomUUID(),
      taskId: command.taskId,
      packageFileId: command.packageFileId,
      objectKey: command.objectKey,
      sha256: command.sha256,
      state: 'reserved',
      expiresAt: command.expiresAt,
    };
    this.uploads.set(reservation.id, reservation);
    return { kind: 'reserved', reservation: structuredClone(reservation) };
  }

  async claimExpiredUploads(now: Date, limit: number): Promise<BidSigningUploadReservation[]> {
    const claimed: BidSigningUploadReservation[] = [];
    for (const upload of this.uploads.values()) {
      if (claimed.length >= limit) break;
      if (
        upload.state === 'cleanup_pending' ||
        (upload.state === 'reserved' && upload.expiresAt <= now)
      ) {
        upload.state = 'cleanup_pending';
        claimed.push(structuredClone(upload));
      }
    }
    return claimed;
  }

  async abandonUpload(reservationId: string): Promise<void> {
    const upload = this.uploads.get(reservationId);
    if (upload && upload.state !== 'finalized') upload.state = 'abandoned';
  }

  async cancel(command: CancelSigningTaskCommand): Promise<BidSigningMutationResult> {
    const target = this.targets.get(command.workspaceId);
    if (!target || target.workspace.companyId !== command.companyId) {
      return { kind: 'not_found' };
    }
    if (target.workspace.version !== command.expectedVersion) {
      return { kind: 'version_conflict' };
    }
    const task = this.tasks.get(command.taskId);
    if (
      !task ||
      task.workspaceId !== command.workspaceId ||
      (task.state !== 'pending' && task.state !== 'claimed')
    ) {
      return { kind: 'invalid_state', reason: 'task_not_active' };
    }
    task.state = 'cancelled';
    task.pairingSecretSha256 = null;
    task.pairingExpiresAt = null;
    task.leaseSecretSha256 = null;
    task.leaseExpiresAt = null;
    task.updatedAt = command.now;
    target.workspace.state = 'frozen';
    target.workspace.version += 1;
    return {
      kind: 'cancelled',
      snapshot: structuredClone({
        task,
        files: target.files.filter((file) => file.requiresSignature),
      }),
    };
  }

  taskFor(workspaceId: string): BidSigningTaskRecord | undefined {
    const task = [...this.tasks.values()].find((item) => item.workspaceId === workspaceId);
    return task ? structuredClone(task) : undefined;
  }

  workspaceFor(workspaceId: string): BidSigningWorkspaceTarget | undefined {
    const workspace = this.targets.get(workspaceId)?.workspace;
    return workspace ? structuredClone(workspace) : undefined;
  }
}

export class DrizzleBidSigningRepository implements BidSigningRepository {
  constructor(private readonly db: Db) {}

  async expireAllStale(now: Date, limit: number): Promise<number> {
    const candidates = await this.db
      .select({
        companyId: bidWorkspaces.companyId,
        workspaceId: bidWorkspaces.id,
      })
      .from(bidSigningTasks)
      .innerJoin(bidWorkspaces, eq(bidWorkspaces.id, bidSigningTasks.workspaceId))
      .where(
        or(
          and(
            eq(bidSigningTasks.state, 'pending'),
            lte(bidSigningTasks.pairingExpiresAt, now),
          ),
          and(
            eq(bidSigningTasks.state, 'claimed'),
            lte(bidSigningTasks.leaseExpiresAt, now),
          ),
        ),
      )
      .limit(Math.max(1, Math.min(limit, 500)));
    let expired = 0;
    for (const candidate of candidates) {
      if (
        await this.expireStale(
          candidate.companyId,
          candidate.workspaceId,
          now,
        )
      ) {
        expired += 1;
      }
    }
    return expired;
  }

  async expireStale(
    companyId: string,
    workspaceId: string,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(
          and(
            eq(bidWorkspaces.companyId, companyId),
            eq(bidWorkspaces.id, workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!workspace) return false;
      const [task] = await tx
        .select()
        .from(bidSigningTasks)
        .where(
          and(
            eq(bidSigningTasks.workspaceId, workspaceId),
            inArray(bidSigningTasks.state, ['pending', 'claimed']),
          ),
        )
        .limit(1)
        .for('update');
      if (!task) return false;
      const deadline = task.state === 'pending' ? task.pairingExpiresAt : task.leaseExpiresAt;
      if (!deadline || deadline > now) return false;
      const [cancelled] = await tx
        .update(bidSigningTasks)
        .set({
          state: 'cancelled',
          pairingSecretSha256: null,
          pairingExpiresAt: null,
          leaseSecretSha256: null,
          leaseExpiresAt: null,
          cancelledAt: now,
          failureCode: 'expired',
          updatedAt: now,
        })
        .where(eq(bidSigningTasks.id, task.id))
        .returning({ id: bidSigningTasks.id });
      if (!cancelled) return false;
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({ state: 'frozen', version: workspace.version + 1, updatedAt: now })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return false;
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'signing_task_expired',
        fromState: workspace.state,
        toState: 'frozen',
        actorSub: 'system:signing-expiry',
        actorName: 'ATLAS Signing Expiry',
        reason: 'Signing task deadline elapsed',
        metadata: { taskId: task.id, expiredState: task.state },
      });
      return true;
    });
  }

  async findActive(
    companyId: string,
    workspaceId: string,
  ): Promise<BidSigningTaskSnapshot | null> {
    const [row] = await this.db
      .select({ task: bidSigningTasks })
      .from(bidSigningTasks)
      .innerJoin(
        bidWorkspaces,
        and(
          eq(bidWorkspaces.id, bidSigningTasks.workspaceId),
          eq(bidWorkspaces.companyId, companyId),
        ),
      )
      .where(
        and(
          eq(bidSigningTasks.workspaceId, workspaceId),
          inArray(bidSigningTasks.state, ['pending', 'claimed']),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      task: mapTask(row.task),
      files: await this.signatureFiles(
        this.db,
        row.task.packageVersionId,
        row.task.workspaceId,
      ),
    };
  }

  async create(command: CreateSigningTaskCommand): Promise<BidSigningMutationResult> {
    return this.db.transaction(async (tx) => {
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
      if (workspace.state !== 'frozen' || workspace.currentPackageVersion === null) {
        return { kind: 'invalid_state' as const, reason: 'workspace_not_frozen' };
      }
      const [packageVersion] = await tx
        .select()
        .from(bidPackageVersions)
        .where(
          and(
            eq(bidPackageVersions.workspaceId, workspace.id),
            eq(bidPackageVersions.version, workspace.currentPackageVersion),
          ),
        )
        .limit(1);
      if (
        !packageVersion ||
        packageVersion.status !== 'frozen' ||
        !packageVersion.manifestSha256
      ) {
        return { kind: 'invalid_state' as const, reason: 'package_not_frozen' };
      }
      const [active] = await tx
        .select({ id: bidSigningTasks.id })
        .from(bidSigningTasks)
        .where(
          and(
            eq(bidSigningTasks.workspaceId, workspace.id),
            inArray(bidSigningTasks.state, ['pending', 'claimed']),
          ),
        )
        .limit(1);
      if (active) return { kind: 'invalid_state' as const, reason: 'active_task_exists' };
      const files = await this.signatureFiles(tx, packageVersion.id, workspace.id);
      if (files.length === 0) {
        return { kind: 'invalid_state' as const, reason: 'no_signature_files' };
      }
      const [task] = await tx
        .insert(bidSigningTasks)
        .values({
          workspaceId: workspace.id,
          packageVersionId: packageVersion.id,
          manifestSha256: packageVersion.manifestSha256,
          signerSub: command.signerSub,
          requestedBySub: command.actor.sub,
          requestedByName: command.actor.name,
          pairingSecretSha256: command.pairingSecretSha256,
          pairingExpiresAt: command.pairingExpiresAt,
          createdAt: command.now,
          updatedAt: command.now,
        })
        .returning();
      if (!task) return { kind: 'not_found' as const };
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({
          signerSub: command.signerSub,
          state: 'awaiting_signature',
          version: workspace.version + 1,
          updatedAt: command.now,
        })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'signing_task_created',
        fromState: 'frozen',
        toState: 'awaiting_signature',
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        metadata: {
          taskId: task.id,
          packageVersion: packageVersion.version,
          manifestSha256: packageVersion.manifestSha256,
          signerSub: command.signerSub,
          fileCount: files.length,
        },
      });
      return {
        kind: 'created' as const,
        snapshot: { task: mapTask(task), files },
      };
    });
  }

  async claim(command: ClaimSigningTaskCommand): Promise<BidSigningMutationResult> {
    return this.db.transaction(async (tx) => {
      const [taskSeed] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1);
      if (!taskSeed) return { kind: 'not_found' as const };
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(eq(bidWorkspaces.id, taskSeed.workspaceId))
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      const [task] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1)
        .for('update');
      if (!task) return { kind: 'not_found' as const };
      if (task.state !== 'pending') {
        return { kind: 'invalid_state' as const, reason: 'not_pending' };
      }
      if (!task.pairingExpiresAt || task.pairingExpiresAt <= command.now) {
        const [expiredWorkspace] = await tx
          .update(bidWorkspaces)
          .set({ state: 'frozen', version: workspace.version + 1, updatedAt: command.now })
          .where(eq(bidWorkspaces.id, workspace.id))
          .returning();
        await tx
          .update(bidSigningTasks)
          .set({
            state: 'cancelled',
            pairingSecretSha256: null,
            pairingExpiresAt: null,
            leaseSecretSha256: null,
            leaseExpiresAt: null,
            cancelledAt: command.now,
            failureCode: 'expired',
            updatedAt: command.now,
          })
          .where(eq(bidSigningTasks.id, task.id));
        if (expiredWorkspace) {
          await tx.insert(bidEvents).values({
            workspaceId: workspace.id,
            sequence: expiredWorkspace.version + 1,
            type: 'signing_task_expired',
            fromState: workspace.state,
            toState: 'frozen',
            actorSub: 'system:signing-expiry',
            actorName: 'ATLAS Signing Expiry',
            reason: 'Pairing deadline elapsed during claim',
            metadata: { taskId: task.id, expiredState: task.state },
          });
        }
        return { kind: 'expired' as const };
      }
      if (task.signerSub !== command.claimantSub) {
        return { kind: 'secret_mismatch' as const };
      }
      if (task.pairingSecretSha256 !== command.pairingSecretSha256) {
        return { kind: 'secret_mismatch' as const };
      }
      if (workspace.state !== 'awaiting_signature') {
        return { kind: 'invalid_state' as const, reason: 'workspace_not_waiting' };
      }
      const [claimed] = await tx
        .update(bidSigningTasks)
        .set({
          state: 'claimed',
          pairingSecretSha256: null,
          pairingExpiresAt: null,
          claimedByDeviceId: command.deviceId,
          claimedByDeviceName: command.deviceName,
          claimedAt: command.now,
          leaseSecretSha256: command.leaseSecretSha256,
          leaseExpiresAt: command.leaseExpiresAt,
          updatedAt: command.now,
        })
        .where(eq(bidSigningTasks.id, task.id))
        .returning();
      if (!claimed) return { kind: 'not_found' as const };
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({
          state: 'signing',
          version: workspace.version + 1,
          updatedAt: command.now,
        })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'signing_task_claimed',
        fromState: 'awaiting_signature',
        toState: 'signing',
        actorSub: command.claimantSub,
        actorName: command.claimantName,
        metadata: {
          taskId: task.id,
          deviceId: command.deviceId,
          deviceName: command.deviceName,
        },
      });
      const files = await this.signatureFiles(
        tx,
        claimed.packageVersionId,
        claimed.workspaceId,
      );
      return {
        kind: 'claimed' as const,
        snapshot: { task: mapTask(claimed), files },
      };
    });
  }

  async authorizeLease(
    command: AuthorizeSigningLeaseCommand,
  ): Promise<BidSigningMutationResult> {
    return this.db.transaction(async (tx) => {
      const [taskSeed] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1);
      if (!taskSeed) return { kind: 'not_found' as const };
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(eq(bidWorkspaces.id, taskSeed.workspaceId))
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      const [task] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1)
        .for('update');
      if (!task) return { kind: 'not_found' as const };
      if (task.state !== 'claimed') {
        return { kind: 'invalid_state' as const, reason: 'not_claimed' };
      }
      if (!task.leaseExpiresAt || task.leaseExpiresAt <= command.now) {
        await tx
          .update(bidSigningTasks)
          .set({
            state: 'cancelled',
            pairingSecretSha256: null,
            pairingExpiresAt: null,
            leaseSecretSha256: null,
            leaseExpiresAt: null,
            cancelledAt: command.now,
            failureCode: 'expired',
            updatedAt: command.now,
          })
          .where(eq(bidSigningTasks.id, task.id));
        const [expiredWorkspace] = await tx
          .update(bidWorkspaces)
          .set({ state: 'frozen', version: workspace.version + 1, updatedAt: command.now })
          .where(eq(bidWorkspaces.id, workspace.id))
          .returning();
        if (expiredWorkspace) {
          await tx.insert(bidEvents).values({
            workspaceId: workspace.id,
            sequence: expiredWorkspace.version + 1,
            type: 'signing_task_expired',
            fromState: workspace.state,
            toState: 'frozen',
            actorSub: 'system:signing-expiry',
            actorName: 'ATLAS Signing Expiry',
            reason: 'Signing lease deadline elapsed during authorization',
            metadata: { taskId: task.id, expiredState: task.state },
          });
        }
        return { kind: 'expired' as const };
      }
      if (
        task.signerSub !== command.claimantSub ||
        task.leaseSecretSha256 !== command.leaseSecretSha256
      ) {
        return { kind: 'secret_mismatch' as const };
      }
      const files = await this.signatureFiles(
        tx,
        task.packageVersionId,
        task.workspaceId,
      );
      return { kind: 'authorized' as const, snapshot: { task: mapTask(task), files } };
    });
  }

  async reserveArtifactUpload(
    command: ReserveSigningArtifactUploadCommand,
  ): Promise<ReserveSigningArtifactUploadResult> {
    const authorized = await this.authorizeLease({
      taskId: command.taskId,
      claimantSub: command.claimantSub,
      leaseSecretSha256: command.leaseSecretSha256,
      now: command.now,
    });
    if (authorized.kind !== 'authorized') {
      if (authorized.kind === 'invalid_state') return authorized;
      if (
        authorized.kind === 'not_found' ||
        authorized.kind === 'secret_mismatch' ||
        authorized.kind === 'expired'
      ) return authorized;
      return { kind: 'invalid_state', reason: 'unexpected_authorization_result' };
    }
    if (!authorized.snapshot.files.some((file) => file.id === command.packageFileId)) {
      return { kind: 'not_found' };
    }
    const [artifact] = await this.db
      .select()
      .from(bidSigningArtifacts)
      .where(
        and(
          eq(bidSigningArtifacts.taskId, command.taskId),
          eq(bidSigningArtifacts.packageFileId, command.packageFileId),
        ),
      )
      .limit(1);
    if (artifact) {
      return artifact.sha256 === command.sha256
        ? { kind: 'artifact_recorded', artifact: mapArtifact(artifact) }
        : { kind: 'invalid_state', reason: 'artifact_conflict' };
    }
    const [existing] = await this.db
      .select()
      .from(bidSigningArtifactUploads)
      .where(eq(bidSigningArtifactUploads.objectKey, command.objectKey))
      .limit(1);
    if (existing?.state === 'reserved') {
      return { kind: 'reserved', reservation: mapUpload(existing) };
    }
    if (existing?.state === 'abandoned') {
      const [renewed] = await this.db
        .update(bidSigningArtifactUploads)
        .set({
          state: 'reserved',
          expiresAt: command.expiresAt,
          lastError: null,
          abandonedAt: null,
          updatedAt: command.now,
        })
        .where(eq(bidSigningArtifactUploads.id, existing.id))
        .returning();
      if (renewed) return { kind: 'reserved', reservation: mapUpload(renewed) };
    }
    if (existing) return { kind: 'invalid_state', reason: 'upload_cleanup_in_progress' };
    const [inserted] = await this.db
      .insert(bidSigningArtifactUploads)
      .values({
        taskId: command.taskId,
        packageFileId: command.packageFileId,
        objectKey: command.objectKey,
        sha256: command.sha256,
        expiresAt: command.expiresAt,
        createdAt: command.now,
        updatedAt: command.now,
      })
      .returning();
    if (!inserted) return { kind: 'not_found' };
    return { kind: 'reserved', reservation: mapUpload(inserted) };
  }

  async claimExpiredUploads(
    now: Date,
    limit: number,
  ): Promise<BidSigningUploadReservation[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bidSigningArtifactUploads)
        .where(
          or(
            eq(bidSigningArtifactUploads.state, 'cleanup_pending'),
            and(
              eq(bidSigningArtifactUploads.state, 'reserved'),
              lte(bidSigningArtifactUploads.expiresAt, now),
            ),
          ),
        )
        .limit(Math.max(1, Math.min(limit, 500)))
        .for('update', { skipLocked: true });
      const claimed: BidSigningUploadReservation[] = [];
      for (const row of rows) {
        const [updated] = await tx
          .update(bidSigningArtifactUploads)
          .set({ state: 'cleanup_pending', updatedAt: now })
          .where(eq(bidSigningArtifactUploads.id, row.id))
          .returning();
        if (updated) claimed.push(mapUpload(updated));
      }
      return claimed;
    });
  }

  async abandonUpload(
    reservationId: string,
    now: Date,
    error?: string,
  ): Promise<void> {
    await this.db
      .update(bidSigningArtifactUploads)
      .set({
        state: error ? 'cleanup_pending' : 'abandoned',
        lastError: error?.slice(0, 2000) ?? null,
        abandonedAt: error ? null : now,
        updatedAt: now,
      })
      .where(
        and(
          eq(bidSigningArtifactUploads.id, reservationId),
          inArray(bidSigningArtifactUploads.state, ['reserved', 'cleanup_pending']),
        ),
      );
  }

  async recordArtifact(
    command: RecordSigningArtifactCommand,
  ): Promise<BidSigningMutationResult> {
    return this.db.transaction(async (tx) => {
      const [taskSeed] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1);
      if (!taskSeed) return { kind: 'not_found' as const };
      const [workspace] = await tx
        .select()
        .from(bidWorkspaces)
        .where(eq(bidWorkspaces.id, taskSeed.workspaceId))
        .limit(1)
        .for('update');
      if (!workspace) return { kind: 'not_found' as const };
      const [task] = await tx
        .select()
        .from(bidSigningTasks)
        .where(eq(bidSigningTasks.id, command.taskId))
        .limit(1)
        .for('update');
      if (!task) return { kind: 'not_found' as const };
      if (task.state !== 'claimed') {
        return { kind: 'invalid_state' as const, reason: 'not_claimed' };
      }
      if (!task.leaseExpiresAt || task.leaseExpiresAt <= command.now) {
        await tx
          .update(bidSigningTasks)
          .set({
            state: 'cancelled',
            pairingSecretSha256: null,
            pairingExpiresAt: null,
            leaseSecretSha256: null,
            leaseExpiresAt: null,
            cancelledAt: command.now,
            failureCode: 'expired',
            updatedAt: command.now,
          })
          .where(eq(bidSigningTasks.id, task.id));
        const [expiredWorkspace] = await tx
          .update(bidWorkspaces)
          .set({ state: 'frozen', version: workspace.version + 1, updatedAt: command.now })
          .where(eq(bidWorkspaces.id, workspace.id))
          .returning();
        if (expiredWorkspace) {
          await tx.insert(bidEvents).values({
            workspaceId: workspace.id,
            sequence: expiredWorkspace.version + 1,
            type: 'signing_task_expired',
            fromState: workspace.state,
            toState: 'frozen',
            actorSub: 'system:signing-expiry',
            actorName: 'ATLAS Signing Expiry',
            reason: 'Signing lease deadline elapsed during artifact finalization',
            metadata: { taskId: task.id, expiredState: task.state },
          });
        }
        return { kind: 'expired' as const };
      }
      if (
        task.signerSub !== command.claimantSub ||
        task.leaseSecretSha256 !== command.leaseSecretSha256
      ) {
        return { kind: 'secret_mismatch' as const };
      }
      const [reservation] = await tx
        .select()
        .from(bidSigningArtifactUploads)
        .where(eq(bidSigningArtifactUploads.id, command.reservationId))
        .limit(1)
        .for('update');
      if (
        !reservation ||
        reservation.state !== 'reserved' ||
        reservation.taskId !== command.taskId ||
        reservation.packageFileId !== command.packageFileId ||
        reservation.objectKey !== command.artifact.objectKey ||
        reservation.sha256 !== command.artifact.sha256
      ) {
        return { kind: 'invalid_state' as const, reason: 'upload_reservation_mismatch' };
      }
      const files = await this.signatureFiles(tx, task.packageVersionId, task.workspaceId);
      if (!files.some((file) => file.id === command.packageFileId)) {
        return { kind: 'not_found' as const };
      }
      const [existing] = await tx
        .select()
        .from(bidSigningArtifacts)
        .where(
          and(
            eq(bidSigningArtifacts.taskId, task.id),
            eq(bidSigningArtifacts.packageFileId, command.packageFileId),
          ),
        )
        .limit(1);
      if (existing) {
        return existing.sha256 === command.artifact.sha256
          ? { kind: 'artifact_recorded' as const, artifact: mapArtifact(existing) }
          : { kind: 'invalid_state' as const, reason: 'artifact_conflict' };
      }
      const [inserted] = await tx
        .insert(bidSigningArtifacts)
        .values({
          taskId: task.id,
          packageFileId: command.packageFileId,
          bucket: command.artifact.bucket,
          objectKey: command.artifact.objectKey,
          filename: command.artifact.filename,
          mime: command.artifact.mime,
          sizeBytes: command.artifact.sizeBytes,
          sha256: command.artifact.sha256,
          certificateThumbprint: command.artifact.certificateThumbprint,
          certificateSubject: command.artifact.certificateSubject,
          signedAt: command.artifact.signedAt,
          createdAt: command.now,
        })
        .returning();
      if (!inserted) return { kind: 'not_found' as const };
      await tx
        .update(bidSigningArtifactUploads)
        .set({ state: 'finalized', finalizedAt: command.now, updatedAt: command.now })
        .where(eq(bidSigningArtifactUploads.id, reservation.id));
      return { kind: 'artifact_recorded' as const, artifact: mapArtifact(inserted) };
    });
  }

  async cancel(command: CancelSigningTaskCommand): Promise<BidSigningMutationResult> {
    return this.db.transaction(async (tx) => {
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
      const [task] = await tx
        .select()
        .from(bidSigningTasks)
        .where(
          and(
            eq(bidSigningTasks.id, command.taskId),
            eq(bidSigningTasks.workspaceId, workspace.id),
          ),
        )
        .limit(1)
        .for('update');
      if (!task || (task.state !== 'pending' && task.state !== 'claimed')) {
        return { kind: 'invalid_state' as const, reason: 'task_not_active' };
      }
      const [cancelled] = await tx
        .update(bidSigningTasks)
        .set({
          state: 'cancelled',
          pairingSecretSha256: null,
          pairingExpiresAt: null,
          leaseSecretSha256: null,
          leaseExpiresAt: null,
          cancelledAt: command.now,
          updatedAt: command.now,
        })
        .where(eq(bidSigningTasks.id, task.id))
        .returning();
      if (!cancelled) return { kind: 'not_found' as const };
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({ state: 'frozen', version: workspace.version + 1, updatedAt: command.now })
        .where(eq(bidWorkspaces.id, workspace.id))
        .returning();
      if (!updated) return { kind: 'not_found' as const };
      await tx.insert(bidEvents).values({
        workspaceId: workspace.id,
        sequence: updated.version + 1,
        type: 'signing_task_cancelled',
        fromState: workspace.state,
        toState: 'frozen',
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        reason: command.reason,
        metadata: { taskId: task.id },
      });
      return {
        kind: 'cancelled' as const,
        snapshot: {
          task: mapTask(cancelled),
          files: await this.signatureFiles(
            tx,
            cancelled.packageVersionId,
            cancelled.workspaceId,
          ),
        },
      };
    });
  }

  private async signatureFiles(
    db: Pick<Db, 'select'>,
    packageVersionId: string,
    workspaceId: string,
  ): Promise<BidSigningInputFile[]> {
    const rows = await db
      .select({
        id: bidPackageFiles.id,
        requirementId: bidPackageFiles.requirementId,
        filename: bidPackageFiles.filename,
        mime: bidPackageFiles.mime,
        sizeBytes: bidPackageFiles.sizeBytes,
        sha256: bidPackageFiles.sha256,
        objectKey: bidPackageFiles.objectKey,
        requiresSignature: bidPackageRequirements.requiresSignature,
      })
      .from(bidPackageFiles)
      .innerJoin(
        bidPackageRequirements,
        and(
          eq(bidPackageRequirements.id, bidPackageFiles.requirementId),
          eq(bidPackageRequirements.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(bidPackageFiles.packageVersionId, packageVersionId),
          eq(bidPackageRequirements.requiresSignature, true),
        ),
      );
    return rows;
  }
}

function mapTask(row: typeof bidSigningTasks.$inferSelect): BidSigningTaskRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    packageVersionId: row.packageVersionId,
    manifestSha256: row.manifestSha256,
    state: row.state as BidSigningTaskState,
    signerSub: row.signerSub,
    requestedBySub: row.requestedBySub,
    requestedByName: row.requestedByName,
    pairingSecretSha256: row.pairingSecretSha256,
    pairingExpiresAt: row.pairingExpiresAt,
    claimedByDeviceId: row.claimedByDeviceId,
    claimedByDeviceName: row.claimedByDeviceName,
    claimedAt: row.claimedAt,
    leaseSecretSha256: row.leaseSecretSha256,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapArtifact(
  row: typeof bidSigningArtifacts.$inferSelect,
): BidSigningArtifactRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    packageFileId: row.packageFileId,
    bucket: row.bucket,
    objectKey: row.objectKey,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    certificateThumbprint: row.certificateThumbprint,
    certificateSubject: row.certificateSubject,
    signedAt: row.signedAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  };
}

function mapUpload(
  row: typeof bidSigningArtifactUploads.$inferSelect,
): BidSigningUploadReservation {
  return {
    id: row.id,
    taskId: row.taskId,
    packageFileId: row.packageFileId,
    objectKey: row.objectKey,
    sha256: row.sha256,
    state: row.state as BidSigningUploadReservation['state'],
    expiresAt: row.expiresAt,
  };
}
