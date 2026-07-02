import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { knowledgeSnapshots } from '../../db/schema';
import type { ExpertKnowledge } from './expert-knowledge.domain';

/**
 * Single-row persistence for the expert agent's precomputed knowledge base.
 * The worker writes after each sweep; the API reads in ~1ms — user latency is
 * decoupled from how expensive the aggregation becomes as the data grows.
 */

const SNAPSHOT_ID = '1';

export const KNOWLEDGE_SNAPSHOT_REPOSITORY = Symbol('KNOWLEDGE_SNAPSHOT_REPOSITORY');

export interface KnowledgeSnapshot {
  payload: ExpertKnowledge;
  computedAt: Date;
}

export interface KnowledgeSnapshotRepository {
  read(): Promise<KnowledgeSnapshot | null>;
  write(payload: ExpertKnowledge, computedAt: Date): Promise<void>;
}

export class InMemoryKnowledgeSnapshotRepository
  implements KnowledgeSnapshotRepository
{
  private snapshot: KnowledgeSnapshot | null = null;

  async read(): Promise<KnowledgeSnapshot | null> {
    return this.snapshot;
  }

  async write(payload: ExpertKnowledge, computedAt: Date): Promise<void> {
    this.snapshot = { payload, computedAt };
  }
}

export class DrizzleKnowledgeSnapshotRepository
  implements KnowledgeSnapshotRepository
{
  constructor(private readonly db: Db) {}

  async read(): Promise<KnowledgeSnapshot | null> {
    const rows = await this.db
      .select()
      .from(knowledgeSnapshots)
      .where(eq(knowledgeSnapshots.id, SNAPSHOT_ID))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    try {
      return {
        payload: JSON.parse(row.payload) as ExpertKnowledge,
        computedAt: row.computedAt,
      };
    } catch {
      // A corrupt payload behaves like "no snapshot" — the next refresh heals it.
      return null;
    }
  }

  async write(payload: ExpertKnowledge, computedAt: Date): Promise<void> {
    await this.db
      .insert(knowledgeSnapshots)
      .values({ id: SNAPSHOT_ID, payload: JSON.stringify(payload), computedAt })
      .onConflictDoUpdate({
        target: knowledgeSnapshots.id,
        set: { payload: JSON.stringify(payload), computedAt },
      });
  }
}
