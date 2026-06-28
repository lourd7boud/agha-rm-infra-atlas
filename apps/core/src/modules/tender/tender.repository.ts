import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { tenders } from '../../db/schema';
import type { QualificationResult } from './qualifier.domain';

export interface CreateTender {
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  /** Lieu d'exécution (panelBlocLieuxExec) — the real geographic field. */
  location?: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  sourceUrl?: string;
}

/**
 * Listing-derived fields a re-crawl refreshes in place. The dedup-safe heal key
 * is sourceUrl (carries refConsultation; never changes for a consultation), so
 * the heal can rewrite even reference/buyerName without risking a duplicate row.
 */
export type ListingFields = Pick<
  CreateTender,
  'reference' | 'buyerName' | 'procedure' | 'objet' | 'location' | 'deadlineAt'
>;

export interface TenderRecord extends CreateTender {
  id: string;
  pipelineState: PipelineState;
  qualification: QualificationResult | null;
  raw: Record<string, unknown> | null;
  createdAt: Date;
  /** Last write to the row — bumped by every enrichment/extraction/state update.
   *  Powers the /tender/inventory `?since=` delta used for live silent refresh. */
  updatedAt: Date;
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
  /**
   * Fills sourceUrl on an already-stored tender (matched by reference+buyer)
   * only when it is currently NULL — never overwrites a known value. Returns
   * whether a row was updated. Lets a re-crawl heal the legacy rows that were
   * ingested before the listing parser captured the canonical detail link.
   */
  backfillSourceUrl(
    reference: string,
    buyerName: string,
    sourceUrl: string,
  ): Promise<boolean>;
  /**
   * Refreshes the listing-derived fields of an existing tender matched on the
   * STABLE sourceUrl. Heals legacy rows whose reference was glued to the objet
   * and whose buyerName held the lieu d'exécution — in place, with zero
   * duplicate-row risk (a reference+buyer match would re-insert once the parser
   * emits the clean values). Returns whether a row was updated.
   */
  healListingBySourceUrl(
    sourceUrl: string,
    fields: ListingFields,
  ): Promise<boolean>;
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
      updatedAt: new Date(),
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

  async backfillSourceUrl(
    reference: string,
    buyerName: string,
    sourceUrl: string,
  ): Promise<boolean> {
    let changed = false;
    this.records = this.records.map((r) => {
      if (
        r.reference === reference &&
        r.buyerName === buyerName &&
        r.sourceUrl === undefined
      ) {
        changed = true;
        return { ...r, sourceUrl };
      }
      return r;
    });
    return changed;
  }

  async healListingBySourceUrl(
    sourceUrl: string,
    fields: ListingFields,
  ): Promise<boolean> {
    let changed = false;
    this.records = this.records.map((r) => {
      if (r.sourceUrl !== sourceUrl) return r;
      // Mirror the DB diff: only a real change counts as a heal.
      const differs =
        r.reference !== fields.reference ||
        r.buyerName !== fields.buyerName ||
        r.procedure !== fields.procedure ||
        r.objet !== fields.objet ||
        r.deadlineAt.getTime() !== fields.deadlineAt.getTime() ||
        (fields.location !== undefined && r.location !== fields.location);
      if (!differs) return r;
      changed = true;
      // Mirror the DB scrub: when objet OR buyerName change, purge stale AI/
      // dossier enrichments computed on the old (wrong) text so the batch
      // re-eligibilises the row. See Drizzle impl for full reasoning.
      const objetOrBuyerChanged =
        r.objet !== fields.objet || r.buyerName !== fields.buyerName;
      const scrubbedRaw =
        objetOrBuyerChanged && r.raw && typeof r.raw === 'object'
          ? Object.fromEntries(
              Object.entries(r.raw as Record<string, unknown>).filter(
                ([k]) => k !== 'aiEnrichment' && k !== 'dossierExtraction',
              ),
            )
          : r.raw;
      return {
        ...r,
        reference: fields.reference,
        buyerName: fields.buyerName,
        procedure: fields.procedure,
        objet: fields.objet,
        deadlineAt: fields.deadlineAt,
        ...(fields.location !== undefined ? { location: fields.location } : {}),
        raw: scrubbedRaw,
      };
    });
    return changed;
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
        location: input.location,
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

  async backfillSourceUrl(
    reference: string,
    buyerName: string,
    sourceUrl: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(tenders)
      .set({ sourceUrl, updatedAt: new Date() })
      .where(
        and(
          eq(tenders.reference, reference),
          eq(tenders.buyerName, buyerName),
          isNull(tenders.sourceUrl),
        ),
      )
      .returning({ id: tenders.id });
    return rows.length > 0;
  }

  async healListingBySourceUrl(
    sourceUrl: string,
    fields: ListingFields,
  ): Promise<boolean> {
    // Only rewrite a row whose listing fields actually differ — keeps the heal
    // a true no-op on an unchanged re-crawl (no write churn, no updated_at
    // thrashing) and makes the `healed` count reflect real changes. location is
    // included in the diff only when this crawl captured one (matching the SET).
    const changed = [
      ne(tenders.reference, fields.reference),
      ne(tenders.buyerName, fields.buyerName),
      ne(tenders.procedure, fields.procedure),
      ne(tenders.objet, fields.objet),
      ne(tenders.deadlineAt, fields.deadlineAt),
      ...(fields.location !== undefined
        ? [sql`${tenders.location} IS DISTINCT FROM ${fields.location}`]
        : []),
    ];
    // When the heal CORRECTS objet or buyerName, any previously stored AI
    // enrichment / dossier extraction was computed on the OLD (wrong) text and
    // describes a different tender — purge those JSONB sub-keys so the batch
    // re-eligibilises the row (aiEnrichBatch skips rows that already have
    // raw.aiEnrichment). Crawler-side facts (reference / deadline / location)
    // change without invalidating AI outputs and are NOT in this gate.
    const objetOrBuyerChanged = or(
      ne(tenders.objet, fields.objet),
      ne(tenders.buyerName, fields.buyerName),
    );
    const rawAfterScrub = sql`CASE WHEN ${objetOrBuyerChanged} THEN
      COALESCE(${tenders.raw}, '{}'::jsonb) - 'aiEnrichment' - 'dossierExtraction'
    ELSE ${tenders.raw} END`;
    const rows = await this.db
      .update(tenders)
      .set({
        reference: fields.reference,
        buyerName: fields.buyerName,
        procedure: fields.procedure,
        objet: fields.objet,
        deadlineAt: fields.deadlineAt,
        // Only overwrite location when this crawl actually captured one, so a
        // transient parse miss never blanks a previously stored value.
        ...(fields.location !== undefined ? { location: fields.location } : {}),
        raw: rawAfterScrub,
        updatedAt: new Date(),
      })
      .where(and(eq(tenders.sourceUrl, sourceUrl), or(...changed)))
      .returning({ id: tenders.id });
    return rows.length > 0;
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
    location: row.location ?? undefined,
    // != null (not truthiness) so a legitimate stored 0 is preserved.
    estimationMad: row.estimationMad != null ? Number(row.estimationMad) : undefined,
    cautionProvisoireMad:
      row.cautionProvisoireMad != null
        ? Number(row.cautionProvisoireMad)
        : undefined,
    deadlineAt: row.deadlineAt,
    sourceUrl: row.sourceUrl ?? undefined,
    pipelineState: row.pipelineState as PipelineState,
    qualification: (row.qualification as QualificationResult | null) ?? null,
    raw: (row.raw as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
