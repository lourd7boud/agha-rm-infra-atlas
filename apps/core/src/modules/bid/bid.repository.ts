import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BidWorkspaceState } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { bidEvents, bidWorkspaces } from '../../db/schema/bid';

export interface BidActor {
  sub: string;
  name: string;
}

export interface BidWorkspaceRecord {
  id: string;
  companyId: string;
  tenderId: string;
  ownerSub: string;
  ownerName: string;
  signerSub: string | null;
  state: BidWorkspaceState;
  version: number;
  currentPackageVersion: number | null;
  officialReceiptEvidenceId: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BidEventRecord {
  id: string;
  workspaceId: string;
  sequence: number;
  type: string;
  fromState: BidWorkspaceState | null;
  toState: BidWorkspaceState | null;
  actorSub: string;
  actorName: string;
  reason: string | null;
  occurredAt: Date;
}

export interface StartWorkspaceCommand {
  companyId: string;
  tenderId: string;
  actor: BidActor;
}

export interface TransitionWorkspaceCommand {
  companyId: string;
  workspaceId: string;
  fromState: BidWorkspaceState;
  toState: BidWorkspaceState;
  expectedVersion: number;
  reason?: string;
  actor: BidActor;
}

export type TransitionWorkspaceResult =
  | { kind: 'updated'; workspace: BidWorkspaceRecord }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' };

export const BID_WORKSPACE_REPOSITORY = Symbol('BID_WORKSPACE_REPOSITORY');

export interface BidWorkspaceRepository {
  start(command: StartWorkspaceCommand): Promise<BidWorkspaceRecord>;
  findById(companyId: string, workspaceId: string): Promise<BidWorkspaceRecord | null>;
  findByTender(companyId: string, tenderId: string): Promise<BidWorkspaceRecord | null>;
  transition(command: TransitionWorkspaceCommand): Promise<TransitionWorkspaceResult>;
}

export class InMemoryBidWorkspaceRepository implements BidWorkspaceRepository {
  private readonly workspaces = new Map<string, BidWorkspaceRecord>();
  private readonly events = new Map<string, BidEventRecord[]>();

  async start(command: StartWorkspaceCommand): Promise<BidWorkspaceRecord> {
    const existing = [...this.workspaces.values()].find(
      (workspace) =>
        workspace.companyId === command.companyId &&
        workspace.tenderId === command.tenderId,
    );
    if (existing) return structuredClone(existing);

    const now = new Date();
    const workspace: BidWorkspaceRecord = {
      id: randomUUID(),
      companyId: command.companyId,
      tenderId: command.tenderId,
      ownerSub: command.actor.sub,
      ownerName: command.actor.name,
      signerSub: null,
      state: 'evaluating',
      version: 0,
      currentPackageVersion: null,
      officialReceiptEvidenceId: null,
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const event: BidEventRecord = {
      id: randomUUID(),
      workspaceId: workspace.id,
      sequence: 1,
      type: 'workspace_started',
      fromState: null,
      toState: 'evaluating',
      actorSub: command.actor.sub,
      actorName: command.actor.name,
      reason: null,
      occurredAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.events.set(workspace.id, [event]);
    return structuredClone(workspace);
  }

  async findById(
    companyId: string,
    workspaceId: string,
  ): Promise<BidWorkspaceRecord | null> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.companyId === companyId ? structuredClone(workspace) : null;
  }

  async findByTender(
    companyId: string,
    tenderId: string,
  ): Promise<BidWorkspaceRecord | null> {
    const workspace = [...this.workspaces.values()].find(
      (candidate) =>
        candidate.companyId === companyId && candidate.tenderId === tenderId,
    );
    return workspace ? structuredClone(workspace) : null;
  }

  async transition(
    command: TransitionWorkspaceCommand,
  ): Promise<TransitionWorkspaceResult> {
    const current = this.workspaces.get(command.workspaceId);
    if (!current || current.companyId !== command.companyId) return { kind: 'not_found' };
    if (
      current.version !== command.expectedVersion ||
      current.state !== command.fromState
    ) {
      return { kind: 'version_conflict' };
    }

    const now = new Date();
    const updated: BidWorkspaceRecord = {
      ...current,
      state: command.toState,
      version: current.version + 1,
      updatedAt: now,
    };
    const event: BidEventRecord = {
      id: randomUUID(),
      workspaceId: current.id,
      sequence: updated.version + 1,
      type: 'state_transitioned',
      fromState: current.state,
      toState: updated.state,
      actorSub: command.actor.sub,
      actorName: command.actor.name,
      reason: command.reason ?? null,
      occurredAt: now,
    };
    this.workspaces.set(updated.id, updated);
    this.events.set(updated.id, [...(this.events.get(updated.id) ?? []), event]);
    return { kind: 'updated', workspace: structuredClone(updated) };
  }

  eventsFor(workspaceId: string): readonly BidEventRecord[] {
    return structuredClone(this.events.get(workspaceId) ?? []);
  }
}

export class DrizzleBidWorkspaceRepository implements BidWorkspaceRepository {
  constructor(private readonly db: Db) {}

  async start(command: StartWorkspaceCommand): Promise<BidWorkspaceRecord> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(bidWorkspaces)
        .values({
          companyId: command.companyId,
          tenderId: command.tenderId,
          ownerSub: command.actor.sub,
          ownerName: command.actor.name,
        })
        .onConflictDoNothing({
          target: [bidWorkspaces.companyId, bidWorkspaces.tenderId],
        })
        .returning();

      if (created) {
        await tx.insert(bidEvents).values({
          workspaceId: created.id,
          sequence: 1,
          type: 'workspace_started',
          toState: 'evaluating',
          actorSub: command.actor.sub,
          actorName: command.actor.name,
        });
        return toWorkspaceRecord(created);
      }

      const [existing] = await tx
        .select()
        .from(bidWorkspaces)
        .where(
          and(
            eq(bidWorkspaces.companyId, command.companyId),
            eq(bidWorkspaces.tenderId, command.tenderId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('Bid workspace conflict resolved without a row');
      return toWorkspaceRecord(existing);
    });
  }

  async findById(
    companyId: string,
    workspaceId: string,
  ): Promise<BidWorkspaceRecord | null> {
    const [row] = await this.db
      .select()
      .from(bidWorkspaces)
      .where(
        and(eq(bidWorkspaces.companyId, companyId), eq(bidWorkspaces.id, workspaceId)),
      )
      .limit(1);
    return row ? toWorkspaceRecord(row) : null;
  }

  async findByTender(
    companyId: string,
    tenderId: string,
  ): Promise<BidWorkspaceRecord | null> {
    const [row] = await this.db
      .select()
      .from(bidWorkspaces)
      .where(
        and(
          eq(bidWorkspaces.companyId, companyId),
          eq(bidWorkspaces.tenderId, tenderId),
        ),
      )
      .limit(1);
    return row ? toWorkspaceRecord(row) : null;
  }

  async transition(
    command: TransitionWorkspaceCommand,
  ): Promise<TransitionWorkspaceResult> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(bidWorkspaces)
        .set({
          state: command.toState,
          version: command.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bidWorkspaces.companyId, command.companyId),
            eq(bidWorkspaces.id, command.workspaceId),
            eq(bidWorkspaces.version, command.expectedVersion),
            eq(bidWorkspaces.state, command.fromState),
          ),
        )
        .returning();

      if (!updated) {
        const [existing] = await tx
          .select({ id: bidWorkspaces.id })
          .from(bidWorkspaces)
          .where(
            and(
              eq(bidWorkspaces.companyId, command.companyId),
              eq(bidWorkspaces.id, command.workspaceId),
            ),
          )
          .limit(1);
        return existing ? { kind: 'version_conflict' } : { kind: 'not_found' };
      }

      await tx.insert(bidEvents).values({
        workspaceId: updated.id,
        sequence: updated.version + 1,
        type: 'state_transitioned',
        fromState: command.fromState,
        toState: command.toState,
        actorSub: command.actor.sub,
        actorName: command.actor.name,
        reason: command.reason,
      });
      return { kind: 'updated', workspace: toWorkspaceRecord(updated) };
    });
  }
}

type BidWorkspaceRow = typeof bidWorkspaces.$inferSelect;

function toWorkspaceRecord(row: BidWorkspaceRow): BidWorkspaceRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    tenderId: row.tenderId,
    ownerSub: row.ownerSub,
    ownerName: row.ownerName,
    signerSub: row.signerSub,
    state: row.state as BidWorkspaceState,
    version: row.version,
    currentPackageVersion: row.currentPackageVersion,
    officialReceiptEvidenceId: row.officialReceiptEvidenceId,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
