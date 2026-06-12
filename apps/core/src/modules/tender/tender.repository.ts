import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { tenders } from '../../db/schema';
import type { QualificationResult } from './qualifier.domain';

export interface CreateTender {
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  sourceUrl?: string;
}

export interface TenderRecord extends CreateTender {
  id: string;
  pipelineState: PipelineState;
  qualification: QualificationResult | null;
  raw: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EnrichmentAmounts {
  estimationMad?: number;
  cautionProvisoireMad?: number;
}

export class DuplicateTenderError extends Error {
  constructor(reference: string, buyerName: string) {
    super(`Tender already registered: ${reference} (${buyerName})`);
    this.name = 'DuplicateTenderError';
  }
}

export const TENDER_REPOSITORY = Symbol('TENDER_REPOSITORY');

export interface TenderRepository {
  create(input: CreateTender): Promise<TenderRecord>;
  findAll(): Promise<TenderRecord[]>;
  findById(id: string): Promise<TenderRecord | null>;
  updateState(id: string, state: PipelineState): Promise<TenderRecord | null>;
  updateQualification(
    id: string,
    state: PipelineState,
    qualification: QualificationResult,
  ): Promise<TenderRecord | null>;
  updateEnrichment(
    id: string,
    amounts: EnrichmentAmounts,
    rawMerge: Record<string, unknown>,
  ): Promise<TenderRecord | null>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryTenderRepository implements TenderRepository {
  private records: readonly TenderRecord[] = [];

  async create(input: CreateTender): Promise<TenderRecord> {
    const duplicate = this.records.some(
      (r) => r.reference === input.reference && r.buyerName === input.buyerName,
    );
    if (duplicate) throw new DuplicateTenderError(input.reference, input.buyerName);
    const record: TenderRecord = {
      ...input,
      id: randomUUID(),
      pipelineState: 'detected',
      qualification: null,
      raw: null,
      createdAt: new Date(),
    };
    this.records = [...this.records, record];
    return record;
  }

  async findAll(): Promise<TenderRecord[]> {
    return [...this.records];
  }

  async findById(id: string): Promise<TenderRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async updateState(id: string, state: PipelineState): Promise<TenderRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: TenderRecord = { ...existing, pipelineState: state };
    this.records = this.records.map((r) => (r.id === id ? updated : r));
    return updated;
  }

  async updateQualification(
    id: string,
    state: PipelineState,
    qualification: QualificationResult,
  ): Promise<TenderRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: TenderRecord = { ...existing, pipelineState: state, qualification };
    this.records = this.records.map((r) => (r.id === id ? updated : r));
    return updated;
  }

  async updateEnrichment(
    id: string,
    amounts: EnrichmentAmounts,
    rawMerge: Record<string, unknown>,
  ): Promise<TenderRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: TenderRecord = {
      ...existing,
      ...(amounts.estimationMad !== undefined
        ? { estimationMad: amounts.estimationMad }
        : {}),
      ...(amounts.cautionProvisoireMad !== undefined
        ? { cautionProvisoireMad: amounts.cautionProvisoireMad }
        : {}),
      raw: { ...(existing.raw ?? {}), ...rawMerge },
    };
    this.records = this.records.map((r) => (r.id === id ? updated : r));
    return updated;
  }
}

export class DrizzleTenderRepository implements TenderRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateTender): Promise<TenderRecord> {
    const existing = await this.db
      .select({ id: tenders.id })
      .from(tenders)
      .where(
        and(
          eq(tenders.reference, input.reference),
          eq(tenders.buyerName, input.buyerName),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new DuplicateTenderError(input.reference, input.buyerName);
    }

    const [row] = await this.db
      .insert(tenders)
      .values({
        reference: input.reference,
        buyerName: input.buyerName,
        procedure: input.procedure,
        objet: input.objet,
        estimationMad: input.estimationMad?.toString(),
        cautionProvisoireMad: input.cautionProvisoireMad?.toString(),
        deadlineAt: input.deadlineAt,
        sourceUrl: input.sourceUrl,
      })
      .returning();
    if (!row) throw new Error('Tender insert returned no row');
    return toRecord(row);
  }

  async findAll(): Promise<TenderRecord[]> {
    const rows = await this.db
      .select()
      .from(tenders)
      .orderBy(asc(tenders.deadlineAt));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<TenderRecord | null> {
    const [row] = await this.db
      .select()
      .from(tenders)
      .where(eq(tenders.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async updateState(id: string, state: PipelineState): Promise<TenderRecord | null> {
    const [row] = await this.db
      .update(tenders)
      .set({ pipelineState: state, updatedAt: new Date() })
      .where(eq(tenders.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async updateQualification(
    id: string,
    state: PipelineState,
    qualification: QualificationResult,
  ): Promise<TenderRecord | null> {
    const [row] = await this.db
      .update(tenders)
      .set({ pipelineState: state, qualification, updatedAt: new Date() })
      .where(eq(tenders.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async updateEnrichment(
    id: string,
    amounts: EnrichmentAmounts,
    rawMerge: Record<string, unknown>,
  ): Promise<TenderRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const [row] = await this.db
      .update(tenders)
      .set({
        ...(amounts.estimationMad !== undefined
          ? { estimationMad: amounts.estimationMad.toString() }
          : {}),
        ...(amounts.cautionProvisoireMad !== undefined
          ? { cautionProvisoireMad: amounts.cautionProvisoireMad.toString() }
          : {}),
        raw: { ...(existing.raw ?? {}), ...rawMerge },
        updatedAt: new Date(),
      })
      .where(eq(tenders.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }
}

type TenderRow = typeof tenders.$inferSelect;

function toRecord(row: TenderRow): TenderRecord {
  return {
    id: row.id,
    reference: row.reference,
    buyerName: row.buyerName,
    procedure: row.procedure as TenderProcedure,
    objet: row.objet,
    estimationMad: row.estimationMad ? Number(row.estimationMad) : undefined,
    cautionProvisoireMad: row.cautionProvisoireMad
      ? Number(row.cautionProvisoireMad)
      : undefined,
    deadlineAt: row.deadlineAt,
    sourceUrl: row.sourceUrl ?? undefined,
    pipelineState: row.pipelineState as PipelineState,
    qualification: (row.qualification as QualificationResult | null) ?? null,
    raw: (row.raw as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}
