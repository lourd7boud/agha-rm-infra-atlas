import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type { PriceScenario, SubmissionResult } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { submissionOutcomes, tenderEvents } from '../../db/schema';

/**
 * Le Grand Livre (Phase 0) — the append-only truth substrate:
 *  - submission_outcome: the reward signal (result of OUR bids);
 *  - tender_event: the transition history (replaces the mutable state column).
 * Both are write-once; nothing here updates or deletes.
 */

// ── Submission outcomes ──────────────────────────────────────────────────────

export interface CreateOutcome {
  tenderId: string;
  result: SubmissionResult;
  montantSoumisMad?: number;
  rabaisRetenuPct?: number;
  scenarioChoisi?: PriceScenario;
  ourRank?: number;
  winnerAmountMad?: number;
  gapToFirstPct: number | null;
  motifRejet?: string;
  lessons?: string[];
  decidedAt: Date;
}

export interface OutcomeRecord extends CreateOutcome {
  id: string;
  createdAt: Date;
}

export const OUTCOME_REPOSITORY = Symbol('OUTCOME_REPOSITORY');

export interface OutcomeRepository {
  record(input: CreateOutcome): Promise<OutcomeRecord>;
  findByTender(tenderId: string): Promise<OutcomeRecord | null>;
}

// ── Tender events ────────────────────────────────────────────────────────────

export interface CreateEvent {
  tenderId: string;
  fromState?: string | null;
  toState: string;
  actor: string;
  reason?: string | null;
}

export interface EventRecord {
  id: string;
  tenderId: string;
  fromState: string | null;
  toState: string;
  actor: string;
  reason: string | null;
  occurredAt: Date;
}

export const TENDER_EVENT_REPOSITORY = Symbol('TENDER_EVENT_REPOSITORY');

export interface EventRepository {
  append(input: CreateEvent): Promise<EventRecord>;
  listByTender(tenderId: string): Promise<EventRecord[]>;
}

// ── In-memory fallbacks (dev/test without DATABASE_URL) ──────────────────────

export class InMemoryOutcomeRepository implements OutcomeRepository {
  private rows: readonly OutcomeRecord[] = [];

  async record(input: CreateOutcome): Promise<OutcomeRecord> {
    const row: OutcomeRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    this.rows = [...this.rows, row];
    return row;
  }

  async findByTender(tenderId: string): Promise<OutcomeRecord | null> {
    const matches = this.rows
      .filter((r) => r.tenderId === tenderId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }
}

export class InMemoryEventRepository implements EventRepository {
  private rows: readonly EventRecord[] = [];

  async append(input: CreateEvent): Promise<EventRecord> {
    const row: EventRecord = {
      id: randomUUID(),
      tenderId: input.tenderId,
      fromState: input.fromState ?? null,
      toState: input.toState,
      actor: input.actor,
      reason: input.reason ?? null,
      occurredAt: new Date(),
    };
    this.rows = [...this.rows, row];
    return row;
  }

  async listByTender(tenderId: string): Promise<EventRecord[]> {
    return this.rows
      .filter((r) => r.tenderId === tenderId)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}

// ── Drizzle implementations ──────────────────────────────────────────────────

export class DrizzleOutcomeRepository implements OutcomeRepository {
  constructor(private readonly db: Db) {}

  async record(input: CreateOutcome): Promise<OutcomeRecord> {
    const [row] = await this.db
      .insert(submissionOutcomes)
      .values({
        tenderId: input.tenderId,
        result: input.result,
        montantSoumisMad: input.montantSoumisMad?.toString(),
        rabaisRetenuPct: input.rabaisRetenuPct?.toString(),
        scenarioChoisi: input.scenarioChoisi,
        ourRank: input.ourRank,
        winnerAmountMad: input.winnerAmountMad?.toString(),
        gapToFirstPct: input.gapToFirstPct?.toString() ?? null,
        motifRejet: input.motifRejet,
        lessons: input.lessons,
        decidedAt: input.decidedAt,
      })
      .returning();
    if (!row) throw new Error('Outcome insert returned no row');
    return toOutcomeRecord(row);
  }

  async findByTender(tenderId: string): Promise<OutcomeRecord | null> {
    const [row] = await this.db
      .select()
      .from(submissionOutcomes)
      .where(eq(submissionOutcomes.tenderId, tenderId))
      .orderBy(desc(submissionOutcomes.createdAt))
      .limit(1);
    return row ? toOutcomeRecord(row) : null;
  }
}

export class DrizzleEventRepository implements EventRepository {
  constructor(private readonly db: Db) {}

  async append(input: CreateEvent): Promise<EventRecord> {
    const [row] = await this.db
      .insert(tenderEvents)
      .values({
        tenderId: input.tenderId,
        fromState: input.fromState ?? null,
        toState: input.toState,
        actor: input.actor,
        reason: input.reason ?? null,
      })
      .returning();
    if (!row) throw new Error('Event insert returned no row');
    return toEventRecord(row);
  }

  async listByTender(tenderId: string): Promise<EventRecord[]> {
    const rows = await this.db
      .select()
      .from(tenderEvents)
      .where(eq(tenderEvents.tenderId, tenderId))
      .orderBy(asc(tenderEvents.occurredAt));
    return rows.map(toEventRecord);
  }
}

type OutcomeRow = typeof submissionOutcomes.$inferSelect;
type EventRow = typeof tenderEvents.$inferSelect;

function toOutcomeRecord(row: OutcomeRow): OutcomeRecord {
  return {
    id: row.id,
    tenderId: row.tenderId,
    result: row.result as SubmissionResult,
    montantSoumisMad: row.montantSoumisMad != null ? Number(row.montantSoumisMad) : undefined,
    rabaisRetenuPct: row.rabaisRetenuPct != null ? Number(row.rabaisRetenuPct) : undefined,
    scenarioChoisi: (row.scenarioChoisi as PriceScenario | null) ?? undefined,
    ourRank: row.ourRank ?? undefined,
    winnerAmountMad: row.winnerAmountMad != null ? Number(row.winnerAmountMad) : undefined,
    gapToFirstPct: row.gapToFirstPct != null ? Number(row.gapToFirstPct) : null,
    motifRejet: row.motifRejet ?? undefined,
    lessons: (row.lessons as string[] | null) ?? undefined,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    tenderId: row.tenderId,
    fromState: row.fromState ?? null,
    toState: row.toState,
    actor: row.actor,
    reason: row.reason ?? null,
    occurredAt: row.occurredAt,
  };
}
