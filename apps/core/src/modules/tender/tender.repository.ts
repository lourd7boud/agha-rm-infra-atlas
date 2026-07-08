import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { tenders } from '../../db/schema';
import type { QualificationResult } from './qualifier.domain';
import {
  buildInventory,
  buildLightItem,
  BUYER_FACET_LIMIT,
  classifyForStorage,
  clampInventoryLimit,
  effectiveLifecycleSet,
  lifecycleFacetFromCounts,
  PROCEDURE_LABELS,
  resolveStoredResult,
  type Inventory,
  type InventoryFacet,
  type InventoryFacets,
  type InventoryFilters,
  type InventoryItem,
  type InventoryPaging,
  type InventoryRow,
  type TenderCategory,
} from './inventory.domain';
import type { CompetitorBidRecord } from '../intel/intel.repository';
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
  // ── Denormalized classification (migration 0033). Written at WRITE time from
  //    classifyForStorage; NULL on legacy rows until the backfill runs. The read
  //    path falls back to on-the-fly inference per field when null. ──
  region?: string | null;
  ville?: string | null;
  category?: string | null;
  secteur?: string | null;
  lotCount?: number | null;
  hasBpu?: boolean | null;
  // ── Denormalized harvested result (migration 0041) — the Stage-2 lifecycle
  //    columns. NULL until the ref+buyer backfill runs; the read applies the
  //    deadline guard so a NULL past-deadline row reads as Clôturé. ──
  resultState?: string | null;
  resultWinnerName?: string | null;
  resultWinnerAmount?: number | null;
  resultDate?: Date | null;
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

/**
 * Terminal states the orchestrator never has an action for — nextActions()
 * returns [] for these (orchestrator.domain), so excluding them in SQL is
 * output-preserving and lets the projected read + composite index scan only the
 * active tail instead of the whole catalogue. Must mirror the domain list.
 */
const ORCHESTRATOR_TERMINAL_STATES: readonly PipelineState[] = [
  'won',
  'lost',
  'no_go',
  'rejected',
];

/**
 * Projected orchestrator row — ONLY what buildComplianceChecklist + nextActions
 * read. The heavy `raw` jsonb (dossier extractions, BPU tables, G1/G2 bodies)
 * never ships: just the small `extraction` sub-object and three artifact-presence
 * booleans are extracted IN Postgres. Replaces the full findAll() that shipped
 * ~100 KB/row for the whole catalogue on every dashboard load.
 */
export interface OrchestratorRow {
  id: string;
  reference: string;
  pipelineState: PipelineState;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
  hasG1Brief: boolean;
  hasG2Scenarios: boolean;
  hasBidDraft: boolean;
  extraction: Record<string, unknown> | null;
}

/** One artifact's activity: how many tenders carry it + its newest timestamp. */
export interface ActivityStat {
  count: number;
  last: string | null;
}

/**
 * Aggregated agents-room activity — computed IN Postgres (FILTER aggregates over
 * the raw jsonb key-presence + a GROUP BY pipeline_state) so the full raw
 * catalogue is never shipped to JS and walked per request. Replaces the old
 * findAll() + eight O(n) JS loops with a single-row aggregate + a tiny histogram.
 */
export interface AgentsActivity {
  g1Brief: ActivityStat;
  g2Scenarios: ActivityStat;
  riskAssessment: ActivityStat;
  bidDraft: ActivityStat;
  estimateSkeleton: ActivityStat;
  extraction: ActivityStat;
  qualifier: ActivityStat;
  stateCounts: Array<{ state: PipelineState; count: number }>;
}

/** Work item for the DB-driven detail backfill (fill-only-empty semantics). */
export interface DetailBackfillTarget {
  id: string;
  reference: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  sourceUrl: string;
}

/** Work item for the "Suivre la commission" (SuiviConsultation) harvest. */
export interface SuiviBacklogTarget {
  id: string;
  reference: string;
  buyerName: string;
  deadlineAt: Date;
  sourceUrl: string;
}

export interface EnrichmentAmounts {
  estimationMad?: number;
  cautionProvisoireMad?: number;
}

/**
 * One priced line harvested from a real détail estimatif — the reference corpus
 * the expert's pricing engine learns from. Structurally a `ReferenceBpuLine`
 * (expert/pricing-reference.domain), so it feeds the price book directly.
 */
export interface ReferenceBpuPrice {
  designation: string;
  unite: string | null;
  prixUnitaireMad: number;
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
   * Priced BPU lines harvested from the détail estimatifs already extracted —
   * the reference corpus the expert's pricing engine learns from. Newest tenders
   * first, bounded by `limit`; only lines carrying a real unit price come back.
   * The bpu sub-arrays of the recent tail are read (not the whole raw catalogue).
   */
  findReferenceBpuPrices(limit: number): Promise<ReferenceBpuPrice[]>;
  /**
   * Projected, terminal-filtered read for the Chef d'Orchestre dashboard: only
   * the fields the compliance checklist + next-action dispatcher need, with the
   * `raw` jsonb reduced to a presence-probe + the small `extraction` sub-object.
   * Excludes terminal tenders in SQL (they carry no action) so the read is
   * O(active), not O(catalogue).
   */
  findForOrchestrator(): Promise<OrchestratorRow[]>;
  /**
   * Single aggregate read for the agents room: per-artifact counts + newest
   * timestamps and a pipeline-state histogram, all computed in Postgres so the
   * full raw catalogue is never shipped to JS just to be counted.
   */
  agentsActivity(): Promise<AgentsActivity>;
  /**
   * Newest-first tenders still missing their caution whose detail page was
   * never fetched (no raw.detail marker) — the work list for the DB-driven
   * detail backfill. One attempt per row: the crawler stamps raw.detail even
   * when the page prints no caution, so this list always shrinks.
   */
  findDetailBackfillTargets(limit: number): Promise<DetailBackfillTarget[]>;
  /**
   * Past-deadline tenders with a source_url whose commission ("Suivre la
   * commission" / SuiviConsultation) has NOT been harvested yet (raw.suivi.v
   * missing/stale), newest-first — the work list for the structured
   * competitor-field harvest (all soumissionnaires + amounts, no OCR).
   */
  findSuiviBacklogTargets(limit: number): Promise<SuiviBacklogTarget[]>;
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
   * DB-side inventory read (P2 scalable-read): pushes filtering, sort, pagination
   * and the column-based facets to Postgres so per-request cost is O(page) instead
   * of O(catalogue). Returns the SAME `{ total, filteredCount, returnedCount,
   * facets, items, filters }` shape as the JS path — a transparent optimization.
   * `bids` is the tiny competitor_bid set (already loaded by the caller): it powers
   * the read-time lifecycle status + facet, which is NOT a stored column (it depends
   * on deadline + harvested results). When a lifecycle filter is active the impl
   * degrades to the exact JS semantics for correctness (documented hybrid).
   */
  findInventoryPage(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Inventory>;
  /**
   * Whole-catalogue, filter-INDEPENDENT half of the inventory read: the total row
   * count + the 6 column facets + the lifecycle facet. These never change with the
   * active filter/sort/page (facets describe the catalogue, not the query — the
   * "stable navigation" contract), so the controller computes this ONCE per cache
   * window and reuses it across every filter/sort/page key AND the `?since=` poll,
   * instead of recomputing 6 GROUP BYs + a whole-catalogue lifecycle scan on every
   * distinct request. `bids` powers the read-time lifecycle facet.
   */
  findInventoryFacets(
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'total' | 'facets'>>;
  /**
   * Filter-DEPENDENT half of the inventory read: the page rows + filteredCount only
   * (NO whole-catalogue facets/total). Per-request cost is O(page) — one indexed
   * `WHERE … ORDER BY … LIMIT/OFFSET` + one `count(*) WHERE …` — so paging/filtering
   * never pays the catalogue-wide facet cost. Merge with findInventoryFacets to get
   * the full Inventory. Lifecycle-filter-active still degrades to the JS pipeline for
   * the page+count (documented hybrid), unchanged.
   */
  findInventoryPageRows(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'filteredCount' | 'returnedCount' | 'items' | 'filters'>>;
  /**
   * Recomputes the denormalized lifecycle-result columns (result_state / winner /
   * date, migration 0041) from the harvested competitor_bid, folded per canonical
   * (reference, buyer) market — the write-time twin of the read-time BidResolver, so
   * the Clôturés/Résultats tabs stay O(page). Idempotent (only changed rows written,
   * updated_at untouched). Called by scripts/backfill-result-state.ts and after each
   * result harvest. Returns the number of rows changed.
   */
  refreshResultState(): Promise<number>;
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

/**
 * Denormalized classification the WRITE path stores in the tender columns
 * (migration 0033). Shared by both repositories so the values never drift from
 * what the read path (classifyForStorage/classifyRow) expects. hasBpu is NOT
 * derived here — it depends on the raw dossier and is (re)computed on
 * enrichment; create/heal leave it untouched.
 */
type ClassificationColumns = ReturnType<typeof classifyForStorage>;

function classificationFor(input: {
  buyerName: string;
  objet: string;
  location?: string | null;
}): ClassificationColumns {
  return classifyForStorage({
    buyerName: input.buyerName,
    objet: input.objet,
    location: input.location ?? null,
  });
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryTenderRepository implements TenderRepository {
  private records: readonly TenderRecord[] = [];

  async create(input: CreateTender): Promise<TenderRecord> {
    const duplicate = this.records.some(
      (r) => r.reference === input.reference && r.buyerName === input.buyerName,
    );
    if (duplicate) throw new DuplicateTenderError(input.reference, input.buyerName);
    const classified = classificationFor(input);
    const record: TenderRecord = {
      ...input,
      id: randomUUID(),
      pipelineState: 'detected',
      qualification: null,
      raw: null,
      region: classified.region,
      ville: classified.ville,
      category: classified.category,
      secteur: classified.secteur,
      lotCount: classified.lotCount,
      hasBpu: false,
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
        // Denormalized classification columns (migration 0033) carried straight
        // through so the read path prefers them over on-the-fly inference.
        region: r.region ?? null,
        ville: r.ville ?? null,
        category: r.category ?? null,
        secteur: r.secteur ?? null,
        lotCount: r.lotCount ?? null,
      };
    });
  }

  async findInventoryPage(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Inventory> {
    // Dev/test only: delegate to the pure JS pipeline over the FULL records so the
    // in-memory path is behaviourally identical to selectInventory + build. The
    // Drizzle impl pushes the same semantics into Postgres.
    return buildInventory([...this.records], filters, now, paging, bids);
  }

  async findInventoryFacets(
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'total' | 'facets'>> {
    // Facets/total are filter-independent (whole catalogue), so an empty filter +
    // default paging yields exactly the same facets the full page would — the JS
    // pipeline computes facets before filtering, so this is byte-identical.
    const inv = buildInventory([...this.records], {}, now, {}, bids);
    return { total: inv.total, facets: inv.facets };
  }

  async findInventoryPageRows(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'filteredCount' | 'returnedCount' | 'items' | 'filters'>> {
    const inv = buildInventory([...this.records], filters, now, paging, bids);
    return {
      filteredCount: inv.filteredCount,
      returnedCount: inv.returnedCount,
      items: inv.items,
      filters: inv.filters,
    };
  }

  async refreshResultState(): Promise<number> {
    // Dev/test no-op: the in-memory read path folds the bids passed to
    // findInventoryPageRows/Facets directly (buildInventory), so it never reads the
    // denormalized result columns. Nothing to precompute.
    return 0;
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

  async findReferenceBpuPrices(limit: number): Promise<ReferenceBpuPrice[]> {
    if (limit <= 0) return [];
    const out: ReferenceBpuPrice[] = [];
    const recent = [...this.records].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
    for (const r of recent) {
      const dossier = readDossierExtraction(r.raw);
      if (!dossier) continue;
      for (const line of dossier.bpu) {
        const price = line.prixUnitaireMad;
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
          continue;
        }
        out.push({
          designation: line.designation,
          unite: line.unite ?? null,
          prixUnitaireMad: price,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async findForOrchestrator(): Promise<OrchestratorRow[]> {
    return this.records
      .filter((r) => !ORCHESTRATOR_TERMINAL_STATES.includes(r.pipelineState))
      .map((r) => {
        const raw = (r.raw ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          reference: r.reference,
          pipelineState: r.pipelineState,
          ...(r.estimationMad !== undefined ? { estimationMad: r.estimationMad } : {}),
          ...(r.cautionProvisoireMad !== undefined
            ? { cautionProvisoireMad: r.cautionProvisoireMad }
            : {}),
          deadlineAt: r.deadlineAt,
          hasG1Brief: raw['g1Brief'] !== undefined,
          hasG2Scenarios: raw['g2Scenarios'] !== undefined,
          hasBidDraft: raw['bidDraft'] !== undefined,
          extraction: (raw['extraction'] ?? null) as Record<string, unknown> | null,
        };
      })
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  }

  async agentsActivity(): Promise<AgentsActivity> {
    const stat = (rawKey: string, tsKey = 'generatedAt'): ActivityStat => {
      let count = 0;
      let last: string | null = null;
      for (const r of this.records) {
        const node = (r.raw as Record<string, unknown> | null)?.[rawKey];
        if (node && typeof node === 'object') {
          count += 1;
          const g = (node as Record<string, unknown>)[tsKey];
          if (typeof g === 'string' && (!last || g > last)) last = g;
        }
      }
      return { count, last };
    };
    let qualCount = 0;
    let qualLast: string | null = null;
    for (const r of this.records) {
      if (r.qualification) {
        qualCount += 1;
        const c = (r.qualification as { checkedAt?: unknown }).checkedAt;
        if (typeof c === 'string' && (!qualLast || c > qualLast)) qualLast = c;
      }
    }
    const stateMap = new Map<PipelineState, number>();
    for (const r of this.records) {
      stateMap.set(r.pipelineState, (stateMap.get(r.pipelineState) ?? 0) + 1);
    }
    return {
      g1Brief: stat('g1Brief'),
      g2Scenarios: stat('g2Scenarios'),
      riskAssessment: stat('riskAssessment'),
      bidDraft: stat('bidDraft'),
      estimateSkeleton: stat('estimateSkeleton'),
      extraction: stat('extraction', 'extractedAt'),
      qualifier: { count: qualCount, last: qualLast },
      stateCounts: [...stateMap.entries()].map(([state, count]) => ({
        state,
        count,
      })),
    };
  }

  async findDetailBackfillTargets(limit: number): Promise<DetailBackfillTarget[]> {
    return this.records
      .filter(
        (r) =>
          r.sourceUrl !== undefined &&
          // Mirror the Drizzle version-aware predicate: target rows whose detail
          // block is missing or stamped by an older parser (raw.detail.v !== 2).
          String(
            (r.raw?.detail as { v?: unknown } | undefined)?.v ?? '',
          ) !== '2',
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

  async findSuiviBacklogTargets(limit: number): Promise<SuiviBacklogTarget[]> {
    const now = Date.now();
    return this.records
      .filter(
        (r) =>
          r.sourceUrl !== undefined &&
          r.deadlineAt.getTime() < now &&
          String((r.raw?.suivi as { v?: unknown } | undefined)?.v ?? '') !== '1',
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(0, limit))
      .map((r) => ({
        id: r.id,
        reference: r.reference,
        buyerName: r.buyerName,
        deadlineAt: r.deadlineAt,
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
      // Re-classify from the healed listing so the denormalized columns never
      // drift from the (corrected) buyerName/objet/location. location falls back
      // to the row's current value when this heal did not capture one.
      const classified = classificationFor({
        buyerName: fields.buyerName,
        objet: fields.objet,
        location: fields.location ?? r.location ?? null,
      });
      return {
        ...r,
        reference: fields.reference,
        buyerName: fields.buyerName,
        procedure: fields.procedure,
        objet: fields.objet,
        deadlineAt: fields.deadlineAt,
        ...(fields.location !== undefined ? { location: fields.location } : {}),
        region: classified.region,
        ville: classified.ville,
        category: classified.category,
        secteur: classified.secteur,
        lotCount: classified.lotCount,
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
    const mergedRaw = { ...(existing.raw ?? {}), ...rawMerge };
    // Recompute has_bpu from the merged dossier so the bpuOnly filter/facet stays
    // correct after an extraction lands (mirrors the SQL jsonb test).
    const dossier = readDossierExtraction(mergedRaw);
    const updated: TenderRecord = {
      ...existing,
      ...(amounts.estimationMad !== undefined
        ? { estimationMad: amounts.estimationMad }
        : {}),
      ...(amounts.cautionProvisoireMad !== undefined
        ? { cautionProvisoireMad: amounts.cautionProvisoireMad }
        : {}),
      hasBpu: dossier ? dossier.bpu.length > 0 : (existing.hasBpu ?? false),
      raw: mergedRaw,
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

    // Classify at WRITE time (P2): store region/ville/category/secteur/lot_count so
    // the list read filters/facets/paginates in the DB instead of classifying the
    // whole catalogue in JS per request. has_bpu starts false (no dossier yet) and
    // is (re)computed in updateEnrichment when an extraction lands.
    const classified = classificationFor(input);
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
        region: classified.region,
        ville: classified.ville,
        category: classified.category,
        secteur: classified.secteur,
        lotCount: classified.lotCount,
        hasBpu: false,
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

  async findForOrchestrator(): Promise<OrchestratorRow[]> {
    // Projected + terminal-filtered: the heavy `raw` never ships — only a
    // presence-probe for the three artifacts nextActions() tests and the small
    // `extraction` sub-object buildComplianceChecklist() reads. The WHERE prunes
    // terminal tenders (no action) so Postgres scans the active tail via the
    // (pipeline_state, deadline_at) index instead of the whole catalogue.
    const rows = await this.db
      .select({
        id: tenders.id,
        reference: tenders.reference,
        pipelineState: tenders.pipelineState,
        estimationMad: tenders.estimationMad,
        cautionProvisoireMad: tenders.cautionProvisoireMad,
        deadlineAt: tenders.deadlineAt,
        hasG1Brief: sql<boolean>`coalesce(jsonb_exists(${tenders.raw}, 'g1Brief'), false)`,
        hasG2Scenarios: sql<boolean>`coalesce(jsonb_exists(${tenders.raw}, 'g2Scenarios'), false)`,
        hasBidDraft: sql<boolean>`coalesce(jsonb_exists(${tenders.raw}, 'bidDraft'), false)`,
        extraction: sql<Record<string, unknown> | null>`${tenders.raw}->'extraction'`,
      })
      .from(tenders)
      .where(notInArray(tenders.pipelineState, [...ORCHESTRATOR_TERMINAL_STATES]))
      .orderBy(asc(tenders.deadlineAt));
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      pipelineState: row.pipelineState as PipelineState,
      ...(row.estimationMad != null
        ? { estimationMad: Number(row.estimationMad) }
        : {}),
      ...(row.cautionProvisoireMad != null
        ? { cautionProvisoireMad: Number(row.cautionProvisoireMad) }
        : {}),
      deadlineAt: row.deadlineAt,
      hasG1Brief: row.hasG1Brief,
      hasG2Scenarios: row.hasG2Scenarios,
      hasBidDraft: row.hasBidDraft,
      extraction: row.extraction ?? null,
    }));
  }

  async agentsActivity(): Promise<AgentsActivity> {
    // One-pass aggregate: per-artifact count + newest timestamp via FILTER, all in
    // Postgres. jsonb_typeof(...) = 'object' mirrors the old JS `typeof node ===
    // 'object'` test; max(... ->> tsKey) mirrors the JS lexicographic max of the
    // ISO string. No raw jsonb is shipped — only the scalar aggregates.
    const [agg] = await this.db
      .select({
        g1Count: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'g1Brief') = 'object')`,
        g1Last: sql<string | null>`max(${tenders.raw}->'g1Brief'->>'generatedAt') filter (where jsonb_typeof(${tenders.raw}->'g1Brief') = 'object')`,
        g2Count: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'g2Scenarios') = 'object')`,
        g2Last: sql<string | null>`max(${tenders.raw}->'g2Scenarios'->>'generatedAt') filter (where jsonb_typeof(${tenders.raw}->'g2Scenarios') = 'object')`,
        riskCount: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'riskAssessment') = 'object')`,
        riskLast: sql<string | null>`max(${tenders.raw}->'riskAssessment'->>'generatedAt') filter (where jsonb_typeof(${tenders.raw}->'riskAssessment') = 'object')`,
        bidCount: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'bidDraft') = 'object')`,
        bidLast: sql<string | null>`max(${tenders.raw}->'bidDraft'->>'generatedAt') filter (where jsonb_typeof(${tenders.raw}->'bidDraft') = 'object')`,
        estCount: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'estimateSkeleton') = 'object')`,
        estLast: sql<string | null>`max(${tenders.raw}->'estimateSkeleton'->>'generatedAt') filter (where jsonb_typeof(${tenders.raw}->'estimateSkeleton') = 'object')`,
        extrCount: sql<number>`count(*) filter (where jsonb_typeof(${tenders.raw}->'extraction') = 'object')`,
        extrLast: sql<string | null>`max(${tenders.raw}->'extraction'->>'extractedAt') filter (where jsonb_typeof(${tenders.raw}->'extraction') = 'object')`,
        qualCount: sql<number>`count(*) filter (where ${tenders.qualification} is not null)`,
        qualLast: sql<string | null>`max(${tenders.qualification}->>'checkedAt') filter (where ${tenders.qualification} is not null)`,
      })
      .from(tenders);
    const stateRows = await this.db
      .select({ state: tenders.pipelineState, count: sql<number>`count(*)` })
      .from(tenders)
      .groupBy(tenders.pipelineState);
    const stat = (
      count: number | undefined,
      last: string | null | undefined,
    ): ActivityStat => ({
      count: Number(count ?? 0),
      last: last ?? null,
    });
    return {
      g1Brief: stat(agg?.g1Count, agg?.g1Last),
      g2Scenarios: stat(agg?.g2Count, agg?.g2Last),
      riskAssessment: stat(agg?.riskCount, agg?.riskLast),
      bidDraft: stat(agg?.bidCount, agg?.bidLast),
      estimateSkeleton: stat(agg?.estCount, agg?.estLast),
      extraction: stat(agg?.extrCount, agg?.extrLast),
      qualifier: stat(agg?.qualCount, agg?.qualLast),
      stateCounts: stateRows.map((row) => ({
        state: row.state as PipelineState,
        count: Number(row.count),
      })),
    };
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
        // Denormalized classification columns (migration 0033) — cheap plain-column
        // reads; the classify pass prefers them and falls back per-field when null.
        region: tenders.region,
        ville: tenders.ville,
        category: tenders.category,
        secteur: tenders.secteur,
        lotCount: tenders.lotCount,
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
      region: row.region,
      ville: row.ville,
      category: row.category,
      secteur: row.secteur,
      lotCount: row.lotCount,
    }));
  }

  async findInventoryPage(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    bids: readonly CompetitorBidRecord[],
  ): Promise<Inventory> {
    // Stage 2: EVERY lifecycle (en_cours/cloture/attribue/infructueux) is now a pure
    // column predicate (deadline_at + the denormalized result_state), so there is NO
    // JS fold and NO fallback — the whole read is O(page) in the DB. Facets/total are
    // filter-INDEPENDENT and page is O(page); compose them for the single-call
    // contract (the controller caches the facets half once per window).
    const [{ total, facets }, page] = await Promise.all([
      this.findInventoryFacets(now, bids),
      this.findInventoryPageRows(filters, paging, now, bids),
    ]);
    return { ...page, total, facets };
  }

  async findInventoryFacets(
    now: Date,
    _bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'total' | 'facets'>> {
    // Stage 2: the lifecycle facet is ONE FILTER-count aggregate over the deadline +
    // denormalized result_state columns — no whole-catalogue (reference,buyer,
    // deadline) projection shipped to JS, no bid fold. `_bids` is unused (kept for
    // the interface / the InMemory JS path).
    const [totalRow, columnFacets, lifecycleRow] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(tenders),
      this.inventoryColumnFacets(),
      this.db
        .select({
          en_cours: sql<number>`count(*) filter (where ${tenders.deadlineAt} >= ${now})::int`,
          cloture: sql<number>`count(*) filter (where ${tenders.deadlineAt} < ${now} and ${tenders.resultState} is null)::int`,
          attribue: sql<number>`count(*) filter (where ${tenders.deadlineAt} < ${now} and ${tenders.resultState} = 'attribue')::int`,
          infructueux: sql<number>`count(*) filter (where ${tenders.deadlineAt} < ${now} and ${tenders.resultState} = 'infructueux')::int`,
        })
        .from(tenders),
    ]);
    const lc = lifecycleRow[0];
    return {
      total: Number(totalRow[0]?.n ?? 0),
      facets: {
        ...columnFacets,
        lifecycles: lifecycleFacetFromCounts({
          en_cours: Number(lc?.en_cours ?? 0),
          cloture: Number(lc?.cloture ?? 0),
          attribue: Number(lc?.attribue ?? 0),
          infructueux: Number(lc?.infructueux ?? 0),
        }),
      },
    };
  }

  async findInventoryPageRows(
    filters: InventoryFilters,
    paging: InventoryPaging,
    now: Date,
    _bids: readonly CompetitorBidRecord[],
  ): Promise<Pick<Inventory, 'filteredCount' | 'returnedCount' | 'items' | 'filters'>> {
    // Stage 2: EVERY lifecycle filter is a pure column predicate (deadline_at +
    // result_state), added to the WHERE by buildInventoryWhere(now). No JS fallback,
    // no bid fold — the page + count are one indexed SQL query each, O(page). The
    // page's lifecycle+winner come from the row's result columns (`_bids` unused;
    // kept for the interface / the InMemory JS path).
    const where = buildInventoryWhere(filters, now);
    const orderBy = inventoryOrderBy(filters);
    const limit = clampInventoryLimit(paging.limit);
    const offset = Math.max(0, Math.floor(paging.offset ?? 0));

    const [pageRows, filteredCountRow] = await Promise.all([
      this.db
        .select(INVENTORY_PAGE_COLUMNS)
        .from(tenders)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      this.db.select({ n: sql<number>`count(*)::int` }).from(tenders).where(where),
    ]);

    const items = buildInventoryPageItems(pageRows, now);
    return {
      filteredCount: Number(filteredCountRow[0]?.n ?? 0),
      returnedCount: items.length,
      items,
      filters,
    };
  }

  async refreshResultState(): Promise<number> {
    // Fold competitor_bid to one result per canonical (reference, buyer) market and
    // stamp the tender's result columns. Same accent-stripping canonicalization as
    // the read-time BidResolver (lower + unaccent + collapse non-alnum + trim), so
    // the SQL lifecycle counts equal the JS bid fold. Idempotent — only rows whose
    // (state, winner_name, winner_amount) change are written, and updated_at is NOT
    // bumped (so it never floods the ?since= live-refresh delta).
    const result = await this.db.execute(sql`
      WITH mk AS (
        SELECT
          btrim(regexp_replace(lower(unaccent(reference)), '[^a-z0-9]+', ' ', 'g')) || '|' ||
          btrim(regexp_replace(lower(unaccent(buyer_name)), '[^a-z0-9]+', ' ', 'g')) AS mkey,
          bool_or(is_winner) AS has_winner,
          (array_agg(bidder_name ORDER BY created_at) FILTER (WHERE is_winner))[1] AS winner_name,
          (array_agg(amount_mad ORDER BY created_at) FILTER (WHERE is_winner))[1] AS winner_amount,
          max(result_date) AS result_date
        FROM intel.competitor_bid
        GROUP BY 1
      )
      UPDATE tender.tender AS t SET
        result_state = CASE WHEN m.has_winner THEN 'attribue' ELSE 'infructueux' END,
        result_winner_name = CASE WHEN m.has_winner THEN m.winner_name ELSE NULL END,
        result_winner_amount = CASE WHEN m.has_winner THEN m.winner_amount ELSE NULL END,
        result_date = m.result_date
      FROM mk m
      WHERE m.mkey =
        btrim(regexp_replace(lower(unaccent(t.reference)), '[^a-z0-9]+', ' ', 'g')) || '|' ||
        btrim(regexp_replace(lower(unaccent(t.buyer_name)), '[^a-z0-9]+', ' ', 'g'))
        AND (t.result_state, t.result_winner_name, t.result_winner_amount) IS DISTINCT FROM (
          CASE WHEN m.has_winner THEN 'attribue' ELSE 'infructueux' END,
          CASE WHEN m.has_winner THEN m.winner_name ELSE NULL END,
          CASE WHEN m.has_winner THEN m.winner_amount ELSE NULL END
        )
    `);
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  /** The 6 column facets (procedures/categories/secteurs/regions/buyers/states)
   *  as indexed GROUP BY aggregates over the WHOLE catalogue — stable navigation
   *  independent of the active filters, matching the JS tallyTop semantics. */
  private async inventoryColumnFacets(): Promise<Omit<InventoryFacets, 'lifecycles'>> {
    const [procedures, categories, secteurs, regions, buyers, states] =
      await Promise.all([
        this.groupCount(tenders.procedure),
        this.groupCount(tenders.category),
        this.groupCount(tenders.secteur),
        this.groupCount(tenders.region),
        this.groupCount(tenders.buyerName, BUYER_FACET_LIMIT),
        this.groupCount(tenders.pipelineState),
      ]);
    const procedureCounts = new Map(procedures.map((p) => [p.value, p.count]));
    return {
      // Procedures keep the PROCEDURE_LABELS declaration order + French labels,
      // dropping empty buckets — exactly like the JS path.
      procedures: (Object.keys(PROCEDURE_LABELS) as TenderProcedure[])
        .map((proc) => ({
          key: proc,
          label: PROCEDURE_LABELS[proc],
          count: procedureCounts.get(proc) ?? 0,
        }))
        .filter((f) => f.count > 0),
      categories: facetsFromCounts(categories),
      secteurs: facetsFromCounts(secteurs),
      regions: facetsFromCounts(regions),
      buyers: facetsFromCounts(buyers),
      states: facetsFromCounts(states),
    };
  }

  /** One GROUP BY count over a text column → ordered [value, count] list (count
   *  DESC, value ASC — the tallyTop order), NULLs skipped (a not-yet-backfilled
   *  row simply doesn't contribute to a bucket). */
  private async groupCount(
    column: AnyPgColumn,
    limit?: number,
  ): Promise<Array<{ value: string; count: number }>> {
    const base = this.db
      .select({ value: column, n: sql<number>`count(*)::int` })
      .from(tenders)
      .where(isNotNull(column))
      .groupBy(column)
      .orderBy(desc(sql`count(*)`), asc(column));
    const rows = await (limit ? base.limit(limit) : base);
    return rows.map((r) => ({ value: String(r.value), count: Number(r.n) }));
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

  async findReferenceBpuPrices(limit: number): Promise<ReferenceBpuPrice[]> {
    if (limit <= 0) return [];
    // Read only the bpu sub-array of the most-recently-updated tenders that carry
    // one (never the whole raw catalogue): ORDER BY updated_at DESC + LIMIT rides
    // the tender_updated_at_idx (migration 0036) and stops after the recent tail,
    // so cost stays bounded no matter how large the catalogue grows. We over-scan
    // tenders because many carry an unpriced estimatif; the line LIMIT caps output.
    const RECENT_TENDER_SCAN = 1500;
    const rows = await this.db
      .select({
        bpu: sql<
          Array<Record<string, unknown>> | null
        >`${tenders.raw}->'dossierExtraction'->'bpu'`,
      })
      .from(tenders)
      .where(sql`jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array'`)
      .orderBy(desc(tenders.updatedAt))
      .limit(RECENT_TENDER_SCAN);

    const out: ReferenceBpuPrice[] = [];
    for (const row of rows) {
      if (!Array.isArray(row.bpu)) continue;
      for (const raw of row.bpu) {
        const line = raw as Record<string, unknown>;
        const designation = typeof line.designation === 'string' ? line.designation : null;
        const price = Number(line.prixUnitaireMad);
        if (!designation || !Number.isFinite(price) || price <= 0) continue;
        out.push({
          designation,
          unite: typeof line.unite === 'string' ? line.unite : null,
          prixUnitaireMad: price,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
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
          sql`${tenders.sourceUrl} IS NOT NULL`,
          // Portal-first harvest: target any row whose detail block is missing OR
          // stamped by an older parser version. NULL raw / no detail / stale v all
          // yield NULL from the path, which IS DISTINCT FROM the current version.
          // Bumping DETAIL_VERSION (detail.parser.ts) re-crawls the whole corpus,
          // self-limiting because each visited row is re-stamped to the new version.
          sql`(${tenders.raw} #>> '{detail,v}') IS DISTINCT FROM '2'`,
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

  async findSuiviBacklogTargets(limit: number): Promise<SuiviBacklogTarget[]> {
    const rows = await this.db
      .select({
        id: tenders.id,
        reference: tenders.reference,
        buyerName: tenders.buyerName,
        deadlineAt: tenders.deadlineAt,
        sourceUrl: tenders.sourceUrl,
      })
      .from(tenders)
      .where(
        and(
          sql`${tenders.sourceUrl} IS NOT NULL`,
          sql`${tenders.deadlineAt} < now()`,
          // Not yet harvested (or stamped by an older version).
          sql`(${tenders.raw} #>> '{suivi,v}') IS DISTINCT FROM '1'`,
        ),
      )
      .orderBy(sql`${tenders.createdAt} DESC`)
      .limit(Math.max(0, limit));
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      buyerName: row.buyerName,
      deadlineAt: row.deadlineAt,
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
    // Re-classify from the CORRECTED listing (P2): the heal exists precisely
    // because buyerName/objet were wrong, so the denormalized columns computed on
    // the old text are stale and must be rewritten. Computed in JS (the classifiers
    // are regex, not SQL) from the incoming fields — identical to what a fresh
    // create() with the corrected listing would store. location uses the captured
    // value when present, else the empty signal (region/ville still fall back to
    // buyer+objet text). has_bpu is left untouched — it tracks the dossier, not the
    // listing.
    const classified = classificationFor({
      buyerName: fields.buyerName,
      objet: fields.objet,
      location: fields.location ?? null,
    });
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
        region: classified.region,
        ville: classified.ville,
        category: classified.category,
        secteur: classified.secteur,
        lotCount: classified.lotCount,
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
    // The merged jsonb is reused for both the raw column and the has_bpu recompute
    // so has_bpu stays consistent with the dossier that just landed — all in the
    // SAME statement (no read-then-write window; the spec pins zero selects).
    const mergedRaw = sql`COALESCE(${tenders.raw}, '{}'::jsonb) || ${JSON.stringify(rawMerge)}::jsonb`;
    const [row] = await this.db
      .update(tenders)
      .set({
        ...(amounts.estimationMad !== undefined
          ? { estimationMad: amounts.estimationMad.toString() }
          : {}),
        ...(amounts.cautionProvisoireMad !== undefined
          ? { cautionProvisoireMad: amounts.cautionProvisoireMad.toString() }
          : {}),
        raw: mergedRaw,
        // Denormalized has_bpu (P2): true iff the merged dossierExtraction.bpu is a
        // non-empty array — the same jsonb test the projected read computes.
        hasBpu: sql<boolean>`case when jsonb_typeof((${mergedRaw})->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length((${mergedRaw})->'dossierExtraction'->'bpu') > 0 else false end`,
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
    // Denormalized classification (migration 0033) — null on legacy rows until
    // the backfill runs; the read path falls back to inference per field.
    region: row.region ?? null,
    ville: row.ville ?? null,
    category: row.category ?? null,
    secteur: row.secteur ?? null,
    lotCount: row.lotCount ?? null,
    hasBpu: row.hasBpu ?? null,
    resultState: row.resultState ?? null,
    resultWinnerName: row.resultWinnerName ?? null,
    resultWinnerAmount:
      row.resultWinnerAmount != null ? Number(row.resultWinnerAmount) : null,
    resultDate: row.resultDate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── DB-side inventory page (P2) helpers ─────────────────────────────────────

/** Region bucket for unmatched rows — mirrors UNLOCATED in inventory.domain. */
const UNLOCATED_REGION = 'Non localisé';
/** Secteur label for the 'autre' segment — mirrors segmentLabel('autre'). */
const DEFAULT_SECTEUR_LABEL = 'Autres';

/**
 * The projected columns the inventory page ships — every field buildLightItem
 * reads, WITHOUT the heavy `raw` jsonb (loaded per-page in the detail drawer).
 * The light enrichment flags come from the same jsonb tests as findAllInventoryRows.
 */
const INVENTORY_PAGE_COLUMNS = {
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
  region: tenders.region,
  ville: tenders.ville,
  category: tenders.category,
  secteur: tenders.secteur,
  lotCount: tenders.lotCount,
  // Stage-2 denormalized result columns — the page builds lifecycle + winner from
  // these (resolveStoredResult), no competitor_bid fold.
  resultState: tenders.resultState,
  resultWinnerName: tenders.resultWinnerName,
  resultWinnerAmount: tenders.resultWinnerAmount,
  resultDate: tenders.resultDate,
  hasBpu: sql<boolean>`case when jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length(${tenders.raw}->'dossierExtraction'->'bpu') > 0 else false end`,
  bpuCount: sql<number>`case when jsonb_typeof(${tenders.raw}->'dossierExtraction'->'bpu') = 'array' then jsonb_array_length(${tenders.raw}->'dossierExtraction'->'bpu') else 0 end`,
  aiResume: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'resume'`,
  aiSecteur: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'secteur'`,
  aiEnrichedAt: sql<string | null>`${tenders.raw}->'aiEnrichment'->>'enrichedAt'`,
  budgetFromDossier: sql<boolean>`case when ${tenders.raw}->'dossierExtraction'->>'estimationMad' is not null then true else false end`,
} as const;

/** Maps a projected inventory-page row to the InventoryRow the build path reads. */
function mapInventoryPageRow(row: {
  id: string;
  reference: string;
  buyerName: string;
  procedure: string;
  objet: string;
  location: string | null;
  estimationMad: string | null;
  cautionProvisoireMad: string | null;
  deadlineAt: Date;
  sourceUrl: string | null;
  pipelineState: string;
  createdAt: Date;
  updatedAt: Date;
  region: string | null;
  ville: string | null;
  category: string | null;
  secteur: string | null;
  lotCount: number | null;
  resultState: string | null;
  resultWinnerName: string | null;
  resultWinnerAmount: string | null;
  resultDate: Date | null;
  hasBpu: boolean;
  bpuCount: number;
  aiResume: string | null;
  aiSecteur: string | null;
  aiEnrichedAt: string | null;
  budgetFromDossier: boolean;
}): InventoryRow {
  return {
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
    region: row.region,
    ville: row.ville,
    category: row.category,
    secteur: row.secteur,
    lotCount: row.lotCount,
    resultState: row.resultState,
    resultWinnerName: row.resultWinnerName,
    resultWinnerAmount:
      row.resultWinnerAmount != null ? Number(row.resultWinnerAmount) : null,
    resultDate: row.resultDate,
  };
}

/** Builds the light display items for the PAGE rows. Lifecycle/winner come from each
 *  row's DENORMALIZED result columns (resolveStoredResult) — no competitor_bid fold,
 *  so Clôturés/Résultats are O(page). NULL classification columns default to the
 *  whole-catalogue buckets (Non localisé / Travaux / Autres), matching the shipped
 *  page path. */
function buildInventoryPageItems(
  pageRows: ReadonlyArray<Parameters<typeof mapInventoryPageRow>[0]>,
  now: Date,
): InventoryItem[] {
  return pageRows.map((row) => {
    const record = mapInventoryPageRow(row);
    // Stage 2: lifecycle + winner come from the row's DENORMALIZED result columns
    // (resolveStoredResult), NOT a competitor_bid fold — so the page never touches
    // the 550k-row bid table and Clôturés/Résultats stay O(page).
    const { competitors, lifecycle, resultDate } = resolveStoredResult(
      {
        deadlineAt: record.deadlineAt,
        resultState: record.resultState ?? null,
        resultWinnerName: record.resultWinnerName ?? null,
        resultWinnerAmount: record.resultWinnerAmount ?? null,
        resultDate: record.resultDate ?? null,
      },
      now,
    );
    return buildLightItem(
      {
        record,
        region: record.region ?? UNLOCATED_REGION,
        ville: record.ville ?? null,
        location: record.location ?? null,
        category: (record.category ?? 'Travaux') as TenderCategory,
        secteur: record.secteur ?? DEFAULT_SECTEUR_LABEL,
        lifecycle,
        competitors,
        resultDate,
      },
      now,
    );
  });
}

/** Ordered [value,count] pairs → InventoryFacet[] (key === label === value). The
 *  SQL already ordered by count DESC, value ASC, so the order is preserved. */
function facetsFromCounts(
  counts: ReadonlyArray<{ value: string; count: number }>,
): InventoryFacet[] {
  return counts.map(({ value, count }) => ({ key: value, label: value, count }));
}

/** Effective value set for a dimension: single param unioned with the multi-select
 *  array. Empty → undefined ("no constraint"), matching effectiveSet in the domain. */
function effectiveValues(
  single: string | undefined,
  multi: readonly string[] | undefined,
): string[] | undefined {
  const values: string[] = [];
  if (single) values.push(single);
  if (multi) values.push(...multi);
  return values.length > 0 ? values : undefined;
}

/**
 * SQL WHERE predicate for a lifecycle filter set (Stage 2) — a pure function of
 * deadline_at + the denormalized result_state, mirroring resolveStoredResult:
 *   en_cours    → deadline_at >= now
 *   cloture     → deadline_at <  now AND result_state IS NULL
 *   attribue    → deadline_at <  now AND result_state = 'attribue'
 *   infructueux → deadline_at <  now AND result_state = 'infructueux'
 * A multi-value set (Résultats = {attribue, infructueux}) is the OR of its members.
 * Empty set ⇒ undefined (no lifecycle constraint).
 */
function lifecycleWhereClause(
  set: ReadonlySet<string>,
  now: Date,
): SQL | undefined {
  const parts: SQL[] = [];
  if (set.has('en_cours')) parts.push(sql`${tenders.deadlineAt} >= ${now}`);
  if (set.has('cloture')) {
    parts.push(sql`(${tenders.deadlineAt} < ${now} and ${tenders.resultState} is null)`);
  }
  if (set.has('attribue')) {
    parts.push(sql`(${tenders.deadlineAt} < ${now} and ${tenders.resultState} = 'attribue')`);
  }
  if (set.has('infructueux')) {
    parts.push(sql`(${tenders.deadlineAt} < ${now} and ${tenders.resultState} = 'infructueux')`);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return or(...parts);
}

/**
 * Builds the SQL WHERE for the inventory page from the same filter semantics as
 * the JS `matches`: multi-select dimensions unioned with their single param via
 * IN, the boolean toggles, the `since` cutoff, and a `q` that combines the datao
 * dual-lane FTS with an ILIKE fallback on reference/buyer/objet so a literal
 * reference ("62/2025") still matches (FTS stems words, not codes). Lifecycle is
 * handled by the caller (not a column). Undefined dimensions add no constraint.
 */
function buildInventoryWhere(
  filters: InventoryFilters,
  now?: Date,
): SQL | undefined {
  const clauses: SQL[] = [];

  // Stage 2: the lifecycle filter is a pure column predicate (deadline_at +
  // result_state), added here when `now` is supplied. Absent lifecycle filter ⇒ no
  // clause. This is what makes ALL four tabs (En cours / Clôturés / Résultats) an
  // indexed page query instead of a whole-catalogue JS fold.
  if (now) {
    const lifecycle = lifecycleWhereClause(effectiveLifecycleSet(filters), now);
    if (lifecycle) clauses.push(lifecycle);
  }

  const procedures = effectiveValues(filters.procedure, filters.procedures);
  if (procedures) clauses.push(inArray(tenders.procedure, procedures));

  const buyers = effectiveValues(filters.buyer, filters.buyers);
  if (buyers) clauses.push(inArray(tenders.buyerName, buyers));

  const regions = effectiveValues(filters.region, filters.regions);
  if (regions) clauses.push(inArray(tenders.region, regions));

  const states = effectiveValues(filters.state, filters.states);
  if (states) clauses.push(inArray(tenders.pipelineState, states));

  const categories = effectiveValues(undefined, filters.categories);
  if (categories) clauses.push(inArray(tenders.category, categories));

  const secteurs = effectiveValues(undefined, filters.secteurs);
  if (secteurs) clauses.push(inArray(tenders.secteur, secteurs));

  if (filters.bpuOnly) clauses.push(eq(tenders.hasBpu, true));
  if (filters.budgetOnly) clauses.push(isNotNull(tenders.estimationMad));
  if (filters.cautionOnly) clauses.push(isNotNull(tenders.cautionProvisoireMad));

  if (filters.since) {
    clauses.push(sql`${tenders.updatedAt} > ${filters.since}`);
  }

  if (filters.q) {
    const like = `%${filters.q}%`;
    // FTS (accent-folded, stemmed) OR literal substring on the headline fields.
    const q = or(
      sql`${tenders.ftsSearch} @@ websearch_to_tsquery('french', ${filters.q})`,
      sql`${tenders.ftsBdpSearch} @@ websearch_to_tsquery('french', ${filters.q})`,
      ilike(tenders.reference, like),
      ilike(tenders.buyerName, like),
      ilike(tenders.objet, like),
    );
    if (q) clauses.push(q);
  }

  return clauses.length > 0 ? and(...clauses) : undefined;
}

/**
 * ORDER BY for the inventory page, mirroring compareBySort: publication→created_at,
 * deadline/daysLeft→deadline_at, estimation→estimation_mad (NULLs last regardless
 * of direction), buyer→buyer_name. reference always breaks ties ASC so the order is
 * stable — identical to the JS comparator.
 */
function inventoryOrderBy(filters: InventoryFilters): SQL[] {
  const sort = filters.sort ?? 'publication';
  const dir = filters.dir ?? 'desc';
  const asc_ = dir === 'asc';
  const tie = asc(tenders.reference);
  switch (sort) {
    case 'deadline':
    case 'daysLeft':
      return [asc_ ? asc(tenders.deadlineAt) : desc(tenders.deadlineAt), tie];
    case 'estimation':
      // NULLS LAST in BOTH directions matches the JS ±Infinity-through-dir trick.
      return [
        asc_
          ? sql`${tenders.estimationMad} asc nulls last`
          : sql`${tenders.estimationMad} desc nulls last`,
        tie,
      ];
    case 'buyer':
      return [asc_ ? asc(tenders.buyerName) : desc(tenders.buyerName), tie];
    case 'publication':
    default:
      return [asc_ ? asc(tenders.createdAt) : desc(tenders.createdAt), tie];
  }
}
