import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { outbox } from '../../db/schema';

export type OutboxStatus = 'en_attente' | 'envoye' | 'echec';

export interface CreateOutboxMessage {
  channel: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface OutboxRecord extends CreateOutboxMessage {
  id: string;
  status: OutboxStatus;
  sentAt?: Date;
  error?: string;
  createdAt: Date;
}

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface OutboxRepository {
  enqueue(input: CreateOutboxMessage): Promise<OutboxRecord>;
  markSent(id: string, sentAt: Date): Promise<OutboxRecord | null>;
  markFailed(id: string, error: string): Promise<OutboxRecord | null>;
  listRecent(limit: number): Promise<OutboxRecord[]>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryOutboxRepository implements OutboxRepository {
  private records: readonly OutboxRecord[] = [];

  async enqueue(input: CreateOutboxMessage): Promise<OutboxRecord> {
    const record: OutboxRecord = {
      ...input,
      id: randomUUID(),
      status: 'en_attente',
      createdAt: new Date(),
    };
    this.records = [...this.records, record];
    return record;
  }

  async markSent(id: string, sentAt: Date): Promise<OutboxRecord | null> {
    return this.update(id, { status: 'envoye', sentAt });
  }

  async markFailed(id: string, error: string): Promise<OutboxRecord | null> {
    return this.update(id, { status: 'echec', error });
  }

  async listRecent(limit: number): Promise<OutboxRecord[]> {
    return [...this.records]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private update(
    id: string,
    patch: Partial<OutboxRecord>,
  ): OutboxRecord | null {
    const existing = this.records.find((r) => r.id === id) ?? null;
    if (!existing) return null;
    const updated: OutboxRecord = { ...existing, ...patch };
    this.records = this.records.map((r) => (r.id === id ? updated : r));
    return updated;
  }
}

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  async enqueue(input: CreateOutboxMessage): Promise<OutboxRecord> {
    const [row] = await this.db.insert(outbox).values(input).returning();
    if (!row) throw new Error('Outbox insert returned no row');
    return toRecord(row);
  }

  async markSent(id: string, sentAt: Date): Promise<OutboxRecord | null> {
    const [row] = await this.db
      .update(outbox)
      .set({ status: 'envoye', sentAt })
      .where(eq(outbox.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async markFailed(id: string, error: string): Promise<OutboxRecord | null> {
    const [row] = await this.db
      .update(outbox)
      .set({ status: 'echec', error })
      .where(eq(outbox.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async listRecent(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.db
      .select()
      .from(outbox)
      .orderBy(desc(outbox.createdAt))
      .limit(limit);
    return rows.map(toRecord);
  }
}

type OutboxRow = typeof outbox.$inferSelect;

function toRecord(row: OutboxRow): OutboxRecord {
  return {
    id: row.id,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status as OutboxStatus,
    sentAt: row.sentAt ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
  };
}
