import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { tenders } from '../../db/schema';
import type { QualificationResult } from './qualifier.domain';
import type { InventoryRow } from './inventory.domain';
import { readAiEnrichment } from './ai-enrichment';
import { readDossierExtraction } from './dossier-extraction';

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

/**
 * The slim projection the expert knowledge base aggregates over. Excludes the
 * heavy columns (raw jsonb with full extractions/BPUs, tsvectors) that made a
 * full-table read minutes-slow — hasBpu is computed INSIDE the SQL instead of
 * shipping every dossier extraction to JS just to test one array's length.
 */
export interface KnowledgeTenderRow {
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  pipelineState: PipelineState;
  hasBpu: boolean;
}

/** Work item for the DB-driven detail backfill (fill-only-empty semantics). */
export interface DetailBackfillTarget {
  id: string;
  reference: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  sourceUrl: string;
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
  /** Slim full-catalogue read for knowledge aggregation — never ships raw. */
  findAllForKnowledge(): Promise<KnowledgeTenderRow[]>;
  /**
   * Newest-first tenders still missing their caution whose detail page was
   * never fetched (no raw.detail marker) — the work list for the DB-driven
   * detail backfill. One attempt per row: the crawler stamps raw.detail even
   * when the page prints no caution, so this list always shrinks.
   */
  findDetailBackfillTargets(limit: number): Promise<DetailBackfillTarget[]>;
  findById(id: string): Promise<TenderRecord | null>;
  /**
   * Batch lookup — one round-trip for N ids (the FTS search endpoint feeds up
   * to 50 ids at once). Order is NOT guaranteed; callers re-order by rank.
   */
  findByIds(ids: string[]): Promise<TenderRecord[]>;
  /**
   * Projected list read for the inventory/list path — every column the classify/
   * facet/filter/sort passes need, WITHOUT the heavy `raw` jsonb, so raw never
   * crosses the wire for the whole catalogue (loaded per-page via findByIds).
   */
  findAllInventoryRows(): Promise<InventoryRow[]>;
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
  /**
   * Datao-parity dual-lane French FTS lookup. Runs
   * `websearch_to_tsquery('french', q)` against both `fts_search` and
   * `fts_bdp_search`, returning ranked ids plus a flag telling the caller
   * whether the hit came from the bordereau lane — the frontend surfaces
   * that as a "Trouvé dans le BPU" badge. In-memory fallback returns [].
   */
  searchIdsByFts(
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; hitBdp: boolean; rank: number }>>;
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

  async findAllInventoryRows(): Promise<InventoryRow[]> {
    return this.records.map((r) => {
      // Dev/test only: parsing raw here is fine (the Drizzle path computes these
      // in SQL so raw never crosses the wire for the whole catalogue).
      const ai = readAiEnrichment(r.raw);
      const dossier = readDossierExtraction(r.raw);
      const bpuCount = dossier?.bpu.length ?? 0;
      return {
        id: r.id,
        reference: r.reference,
        buyerName: r.buyerName,
        procedure: r.procedure,
        objet: r.objet,
        location: r.location,
        estimationMad: r.estimationMad,
        cautionProvisoireMad: r.cautionProvisoireMad,
        deadlineAt: r.deadlineAt,
        sourceUrl: r.sourceUrl,
        pipelineState: r.pipelineState,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        hasBpu: bpuCount > 0,
        bpuCount,
        aiResume: ai?.resume,
        aiSecteur: ai?.secteur,
        aiEnrichedAt: ai?.enrichedAt,
        budgetFromDossier: dossier?.estimationMad != null,
      };
    });
  }

  async findAllForKnowledge(): Promise<KnowledgeTenderRow[]> {
    return this.records.map((r) => {
      const extraction = (r.raw as { dossierExtraction?: { bpu?: unknown } } | null)
        ?.dossierExtraction;
      return {
        reference: r.reference,
        buyerName: r.buyerName,
        procedure: r.procedure,
        objet: r.objet,
        ...(r.estimationMad !== undefined ? { estimationMad: r.estimationMad } : {}),
        ...(r.cautionProvisoireMad !== undefined
          ? { cautionProvisoireMad: r.cautionProvisoireMad }
          : {}),
        deadlineAt: r.deadlineAt,
        pipelineState: r.pipelineState,
        hasBpu: Array.isArray(extraction?.bpu) && extraction.bpu.length > 0,
      };
    });
  }

  async findDetailBackfillTargets(limit: number): Promise<DetailBackfillTarget[]> {
    return this.records
      .filter(
        (r) =>
          r.sourceUrl !== undefined &&
          r.cautionProvisoireMad === undefined &&
          !(r.raw && 'detail' in r.raw),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(0, limit))
      .map((r) => ({
        id: r.id,
        reference: r.reference,
        ...(r.estimationMad !== undefined ? { estimationMad: r.estimationMad } : {}),
        ...(r.cautionProvisoireMad !== undefined
          ? { cautionProvisoireMad: r.cautionProvisoireMad }
          : {}),
        sourceUrl: r.sourceUrl as string,
      }));
  }

  async findById(id: string): Promise<TenderRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async findByIds(ids: string[]): Promise<TenderRecord[]> {
    const wanted = new Set(ids);
    return this.records.filter((r) => wanted.has(r.id));
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

  async searchIdsByFts(): Promise<
    Array<{ id: string; hitBdp: boolean; rank: number }>
  > {
    // In-memory fallback has no tsvector infra; callers fall back to the
    // substring path in inventory.domain when this returns [].
    return [];
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

  async findAllInventoryRows(): Promise<InventoryRow[]> {
    // Projected: NO raw jsonb / tsvectors / qualification — raw never crosses the
    // wire for the whole catalogue (loaded per-page via findByIds). The light
    // enrichment flags/strings the LIST rows show are computed INSIDE the SQL
    // (jsonb array-length / ->> extraction), so the heavy dossier/ai objects are
    // never shipped just to test one array's length or read one résumé line.
    // Unordered: selectInventory sorts by publication in JS.
    const rows = await this.db
      .select({
        id: tenders.id,
        reference: tenders.reference,
        buyerName: tenders.buyerName,
        procedure: tenders.procedure,
        objet: tenders.objet,
        location: tenders.location,
        estimationMad: tenders.estimationMad,
        cautionProvisoireMad: tenders.cautionProvisoireMad,
        deadlineAt: tenders.deadlineAt,
        sourceUrl: tenders.sourceUrl,
        pipelineState: tenders.pipelineState,
        createdAt: tenders.createdAt,
        updatedAt: tenders.updatedAt,
        hasBpu: sql<boolean>`case when jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length(${tenders.raw}->'dossierExtraction'->'bpu') > 0 else false end`,
        bpuCount: sql<number>`case when jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length(${tenders.raw}->'dossierExtraction'->'bpu') else 0 end`,
        aiResume: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'resume'`,
        aiSecteur: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'secteur'`,
        aiEnrichedAt: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'enrichedAt'`,
        budgetFromDossier: sql<boolean>`case when ${tenders.raw}->'dossierExtraction'->>'estimationMad' is not null then true else false end`,
      })
      .from(tenders);
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      buyerName: row.buyerName,
      procedure: row.procedure as TenderProcedure,
      objet: row.objet,
      location: row.location ?? undefined,
      estimationMad: row.estimationMad != null ? Number(row.estimationMad) : undefined,
      cautionProvisoireMad:
        row.cautionProvisoireMad != null ? Number(row.cautionProvisoireMad) : undefined,
      deadlineAt: row.deadlineAt,
      sourceUrl: row.sourceUrl ?? undefined,
      pipelineState: row.pipelineState as PipelineState,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      hasBpu: row.hasBpu,
      bpuCount: Number(row.bpuCount),
      aiResume: row.aiResume ?? undefined,
      aiSecteur: row.aiSecteur ?? undefined,
      aiEnrichedAt: row.aiEnrichedAt ?? undefined,
      budgetFromDossier: row.budgetFromDossier,
    }));
  }

  async findAllForKnowledge(): Promise<KnowledgeTenderRow[]> {
    const rows = await this.db
      .select({
        reference: tenders.reference,
        buyerName: tenders.buyerName,
        procedure: tenders.procedure,
        objet: tenders.objet,
        estimationMad: tenders.estimationMad,
        cautionProvisoireMad: tenders.cautionProvisoireMad,
        deadlineAt: tenders.deadlineAt,
        pipelineState: tenders.pipelineState,
        // Array-length test stays in the database — the raw jsonb never
        // crosses the wire for a knowledge read.
        hasBpu: sql<boolean>`case when jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length(${tenders.raw}->'dossierExtraction'->'bpu') > 0 else false end`,
      })
      .from(tenders);
    return rows.map((row) => ({
      reference: row.reference,
      buyerName: row.buyerName,
      procedure: row.procedure as TenderProcedure,
      objet: row.objet,
      ...(row.estimationMad != null
        ? { estimationMad: Number(row.estimationMad) }
        : {}),
      ...(row.cautionProvisoireMad != null
        ? { cautionProvisoireMad: Number(row.cautionProvisoireMad) }
        : {}),
      deadlineAt: row.deadlineAt,
      pipelineState: row.pipelineState as PipelineState,
      hasBpu: row.hasBpu,
    }));
  }

  async findDetailBackfillTargets(limit: number): Promise<DetailBackfillTarget[]> {
    const rows = await this.db
      .select({
        id: tenders.id,
        reference: tenders.reference,
        estimationMad: tenders.estimationMad,
        cautionProvisoireMad: tenders.cautionProvisoireMad,
        sourceUrl: tenders.sourceUrl,
      })
      .from(tenders)
      .where(
        and(
          isNull(tenders.cautionProvisoireMad),
          sql`${tenders.sourceUrl} IS NOT NULL`,
          sql`NOT (${tenders.raw} ? 'detail')`,
        ),
      )
      .orderBy(sql`${tenders.createdAt} DESC`)
      .limit(Math.max(0, limit));
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      ...(row.estimationMad != null
        ? { estimationMad: Number(row.estimationMad) }
        : {}),
      ...(row.cautionProvisoireMad != null
        ? { cautionProvisoireMad: Number(row.cautionProvisoireMad) }
        : {}),
      sourceUrl: row.sourceUrl as string,
    }));
  }

  async findById(id: string): Promise<TenderRecord | null> {
    const [row] = await this.db
      .select()
      .from(tenders)
      .where(eq(tenders.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<TenderRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(tenders)
      .where(inArray(tenders.id, ids));
    return rows.map(toRecord);
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
    // Single atomic statement: the JSONB merge runs server-side, so two
    // concurrent writers (auto-extract + manual trigger on the same tender)
    // can never clobber each other's keys through a stale read.
    const [row] = await this.db
      .update(tenders)
      .set({
        ...(amounts.estimationMad !== undefined
          ? { estimationMad: amounts.estimationMad.toString() }
          : {}),
        ...(amounts.cautionProvisoireMad !== undefined
          ? { cautionProvisoireMad: amounts.cautionProvisoireMad.toString() }
          : {}),
        raw: sql`COALESCE(${tenders.raw}, '{}'::jsonb) || ${JSON.stringify(rawMerge)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(tenders.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async searchIdsByFts(
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; hitBdp: boolean; rank: number }>> {
    // Both lanes run through websearch_to_tsquery('french') so a phrase like
    // "câbles électriques" hits tenders whose title carries it AND tenders
    // whose bordereau lists it as a BPU line item. The GREATEST() rank keeps
    // the ordering intuitive regardless of which lane matched.
    const rows = await this.db.execute<{
      id: string;
      hit_bdp: boolean;
      rank: number;
    }>(sql`
      SELECT t.id::text AS id,
             (t.fts_bdp_search @@ tsq) AS hit_bdp,
             GREATEST(
               ts_rank(t.fts_search, tsq),
               ts_rank(t.fts_bdp_search, tsq)
             ) AS rank
        FROM tender.tender AS t,
             websearch_to_tsquery('french', ${q}) AS tsq
       WHERE t.fts_search @@ tsq
          OR t.fts_bdp_search @@ tsq
       ORDER BY rank DESC
       LIMIT ${limit}
    `);
    return rows.rows.map((r) => ({
      id: r.id,
      hitBdp: r.hit_bdp,
      rank: Number(r.rank),
    }));
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
