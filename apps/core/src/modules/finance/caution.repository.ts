import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { cautions } from '../../db/schema';
import type { CautionKind, CautionStatus } from './finance.domain';

export interface CreateCaution {
  kind: CautionKind;
  reference: string;
  amountMad: number;
  issuedAt: Date;
  tenderId?: string;
  projectId?: string;
  bankName?: string;
  notes?: string;
}

export interface CautionRecord extends CreateCaution {
  id: string;
  status: CautionStatus;
  releasedAt?: Date;
  createdAt: Date;
}

export const CAUTION_REPOSITORY = Symbol('CAUTION_REPOSITORY');

export interface CautionRepository {
  create(input: CreateCaution): Promise<CautionRecord>;
  findAll(): Promise<CautionRecord[]>;
  findById(id: string): Promise<CautionRecord | null>;
  release(id: string, releasedAt: Date): Promise<CautionRecord | null>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryCautionRepository implements CautionRepository {
  private records: readonly CautionRecord[] = [];

  async create(input: CreateCaution): Promise<CautionRecord> {
    const record: CautionRecord = {
      ...input,
      id: randomUUID(),
      status: 'active',
      createdAt: new Date(),
    };
    this.records = [...this.records, record];
    return record;
  }

  async findAll(): Promise<CautionRecord[]> {
    return [...this.records];
  }

  async findById(id: string): Promise<CautionRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async release(id: string, releasedAt: Date): Promise<CautionRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: CautionRecord = { ...existing, status: 'liberee', releasedAt };
    this.records = this.records.map((r) => (r.id === id ? updated : r));
    return updated;
  }
}

export class DrizzleCautionRepository implements CautionRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateCaution): Promise<CautionRecord> {
    const [row] = await this.db
      .insert(cautions)
      .values({
        kind: input.kind,
        reference: input.reference,
        amountMad: input.amountMad.toString(),
        issuedAt: input.issuedAt,
        tenderId: input.tenderId,
        projectId: input.projectId,
        bankName: input.bankName,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Caution insert returned no row');
    return toRecord(row);
  }

  async findAll(): Promise<CautionRecord[]> {
    const rows = await this.db
      .select()
      .from(cautions)
      .orderBy(desc(cautions.createdAt));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<CautionRecord | null> {
    const [row] = await this.db
      .select()
      .from(cautions)
      .where(eq(cautions.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async release(id: string, releasedAt: Date): Promise<CautionRecord | null> {
    const [row] = await this.db
      .update(cautions)
      .set({ status: 'liberee', releasedAt })
      .where(eq(cautions.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }
}

type CautionRow = typeof cautions.$inferSelect;

function toRecord(row: CautionRow): CautionRecord {
  return {
    id: row.id,
    kind: row.kind as CautionKind,
    reference: row.reference,
    amountMad: Number(row.amountMad),
    issuedAt: row.issuedAt,
    tenderId: row.tenderId ?? undefined,
    projectId: row.projectId ?? undefined,
    bankName: row.bankName ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status as CautionStatus,
    releasedAt: row.releasedAt ?? undefined,
    createdAt: row.createdAt,
  };
}
