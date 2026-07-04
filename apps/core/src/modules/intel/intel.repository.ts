import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { competitorBids, competitors } from '../../db/schema';
import { normalizeFr } from '../tender/qualifier.domain';
import { inferSegment } from '../tender/inventory.domain';
import type { PublishedResult } from './intel.parser';
import { buildCompetitorProfile, type CompetitorProfile } from './intel.profile';
import {
  normalizeCompanyName,
  PARTICIPATION_TOP_LIMIT,
  summarizeParticipation,
  type ParticipationSummary,
} from './participation.domain';
import {
  summarizeRebates,
  UNKNOWN_BUYER_LABEL,
  type RebateBenchmarks,
  type RebateObservation,
} from './rebate.domain';

// The canonical company fold moved to participation.domain (the pure fold and
// the repository must share it without a require cycle); re-exported so every
// existing importer (portal outcome, expert knowledge, specs) keeps this path.
export { normalizeCompanyName } from './participation.domain';

export interface CompetitorRecord {
  id: string;
  canonicalName: string;
  normalizedName: string;
}

export interface CompetitorBidRecord extends PublishedResult {
  id: string;
  competitorId: string;
  createdAt: Date;
}

export interface CompetitorStats {
  id: string;
  canonicalName: string;
  wins: number;
  totalMad: number;
}

/**
 * Repository-level participation aggregate — same shape as the pure
 * `summarizeParticipation` output. Implementations cap byBuyer/topCompetitors
 * at PARTICIPATION_TOP_LIMIT; the SQL implementation computes everything in
 * the database so no consumer has to pull the full bid table into JS.
 */
export type ParticipationStats = ParticipationSummary;

export const INTEL_REPOSITORY = Symbol('INTEL_REPOSITORY');

export interface IntelRepository {
  /** Finds by normalized name or creates — entity resolution v1. */
  upsertCompetitor(rawName: string): Promise<CompetitorRecord>;
  /** Inserts unless (reference, competitorId) already recorded. Returns false on duplicate. */
  insertResult(result: PublishedResult, competitorId: string): Promise<boolean>;
  /**
   * Inserts the bid, or — when (reference, competitorId) already exists —
   * enriches it with newly-known estimation/objet/amount and the winner flag.
   * The PV extract is the authoritative, richer source, so it back-fills what
   * the résultat-définitif notice lacked. Returns the action taken.
   */
  upsertResult(
    result: PublishedResult,
    competitorId: string,
  ): Promise<'inserted' | 'updated'>;
  listResults(limit: number): Promise<CompetitorBidRecord[]>;
  /**
   * All recorded bids — used by the tender inventory to attach the winner +
   * losing-bidder list to each tender row (the "Résultat de l'appel d'offre"
   * datao surface). One full scan instead of N+1 per-tender queries; cheap
   * because competitor_bid scales with results harvested, not with tenders.
   */
  listAllBids(): Promise<CompetitorBidRecord[]>;
  /**
   * Returns only the WINNER bids (`isWinner`) whose reference matches one of the
   * given canonical reference keys (folded with {@link canonicalReferenceKey}:
   * lowercased, every non-alphanumeric run collapsed to a single space, trimmed).
   * Used by the portal outcome reconciliation to join OUR soumissions to the
   * published attributions WITHOUT scanning the whole competitor_bid table — the
   * old fixed limit silently dropped winners past the ceiling, producing false
   * 'en_attente' verdicts as the dataset grew. An empty input yields an empty list.
   */
  findWinnersByReferences(
    canonicalKeys: readonly string[],
  ): Promise<CompetitorBidRecord[]>;
  /**
   * Participation aggregates (bidders per consultation, per-buyer field,
   * winners league) computed WITHOUT handing the bid table to the caller.
   * competitor_bid is heading for 150k-300k rows (129k-notice historical
   * backfill): consumers that only need these aggregates must use this
   * instead of listAllBids(). Lists are capped at PARTICIPATION_TOP_LIMIT.
   */
  participationStats(): Promise<ParticipationStats>;
  listCompetitorStats(): Promise<CompetitorStats[]>;
  /** C2: full dossier for one competitor, null when unknown. */
  getProfile(competitorId: string): Promise<CompetitorProfile | null>;
  /** M2 calibration: recovered winning-rebate benchmarks, overall + by buyer/segment. */
  rebateBenchmarks(): Promise<RebateBenchmarks>;
}

/** Map a stored bid to the rebate domain's observation (segment from objet+buyer). */
function bidToObservation(bid: {
  reference: string;
  buyerName: string;
  objet?: string;
  estimationMad?: number;
  amountMad?: number;
  isWinner: boolean;
}): RebateObservation {
  return {
    reference: bid.reference,
    buyerName: bid.buyerName,
    segment: inferSegment(bid.objet ?? '', bid.buyerName),
    estimationMad: bid.estimationMad,
    amountMad: bid.amountMad,
    isWinner: bid.isWinner,
  };
}

/** Shape of a competitor_bid row as returned by `db.select().from(competitorBids)`. */
type CompetitorBidRow = {
  id: string;
  reference: string;
  buyerName: string;
  bidderName: string;
  competitorId: string | null;
  amountMad: string | null;
  estimationMad: string | null;
  objet: string | null;
  isWinner: boolean;
  resultDate: Date | null;
  sourceUrl: string | null;
  createdAt: Date;
};

/** Maps a raw competitor_bid row to the domain record (numerics back to numbers). */
function mapBidRow(row: CompetitorBidRow): CompetitorBidRecord {
  return {
    id: row.id,
    reference: row.reference,
    buyerName: row.buyerName,
    bidderName: row.bidderName,
    competitorId: row.competitorId ?? '',
    amountMad: row.amountMad ? Number(row.amountMad) : undefined,
    estimationMad: row.estimationMad ? Number(row.estimationMad) : undefined,
    objet: row.objet ?? undefined,
    isWinner: row.isWinner,
    resultDate: row.resultDate ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    createdAt: row.createdAt,
  };
}

/** Drizzle insert row for a competitor bid (numerics stored as strings). */
function bidInsertValues(result: PublishedResult, competitorId: string) {
  return {
    reference: result.reference,
    buyerName: result.buyerName,
    bidderName: result.bidderName,
    competitorId,
    amountMad: result.amountMad?.toString(),
    estimationMad: result.estimationMad?.toString(),
    objet: result.objet,
    isWinner: result.isWinner,
    resultDate: result.resultDate,
    sourceUrl: result.sourceUrl,
  };
}

/**
 * Canonical join key for a market référence. The same market arrives from two
 * independent paths (our authenticated "Mes réponses" listing vs the public
 * result crawler) as short codes like "62/2025/DP A/IF", so case, spacing and
 * punctuation drift. Folding case + collapsing every non-alphanumeric run to a
 * single space keeps both sides agreeing on what "the same market" is. Lives
 * here so the SQL canonicalizer in findWinnersByReferences and the in-memory
 * matcher share ONE definition with the portal outcome domain, which
 * re-exports it.
 */
export function canonicalReferenceKey(reference: string): string {
  return normalizeFr(reference)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class InMemoryIntelRepository implements IntelRepository {
  private competitors: readonly CompetitorRecord[] = [];
  private bids: readonly CompetitorBidRecord[] = [];

  async upsertCompetitor(rawName: string): Promise<CompetitorRecord> {
    const normalized = normalizeCompanyName(rawName);
    const existing = this.competitors.find((c) => c.normalizedName === normalized);
    if (existing) return existing;
    const record: CompetitorRecord = {
      id: randomUUID(),
      canonicalName: rawName.trim(),
      normalizedName: normalized,
    };
    this.competitors = [...this.competitors, record];
    return record;
  }

  async insertResult(
    result: PublishedResult,
    competitorId: string,
  ): Promise<boolean> {
    const duplicate = this.bids.some(
      (bid) => bid.reference === result.reference && bid.competitorId === competitorId,
    );
    if (duplicate) return false;
    this.bids = [
      ...this.bids,
      { ...result, id: randomUUID(), competitorId, createdAt: new Date() },
    ];
    return true;
  }

  async upsertResult(
    result: PublishedResult,
    competitorId: string,
  ): Promise<'inserted' | 'updated'> {
    const index = this.bids.findIndex(
      (bid) =>
        bid.reference === result.reference && bid.competitorId === competitorId,
    );
    if (index === -1) {
      this.bids = [
        ...this.bids,
        { ...result, id: randomUUID(), competitorId, createdAt: new Date() },
      ];
      return 'inserted';
    }
    const existing = this.bids[index]!;
    const merged: CompetitorBidRecord = {
      ...existing,
      // Prefer a real buyer name over the placeholder, whichever side has it.
      buyerName:
        result.buyerName !== UNKNOWN_BUYER_LABEL
          ? result.buyerName
          : existing.buyerName,
      amountMad: result.amountMad ?? existing.amountMad,
      estimationMad: result.estimationMad ?? existing.estimationMad,
      objet: result.objet ?? existing.objet,
      isWinner: existing.isWinner || result.isWinner,
    };
    this.bids = [
      ...this.bids.slice(0, index),
      merged,
      ...this.bids.slice(index + 1),
    ];
    return 'updated';
  }

  async listResults(limit: number): Promise<CompetitorBidRecord[]> {
    return [...this.bids]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listAllBids(): Promise<CompetitorBidRecord[]> {
    return [...this.bids];
  }

  async findWinnersByReferences(
    canonicalKeys: readonly string[],
  ): Promise<CompetitorBidRecord[]> {
    if (canonicalKeys.length === 0) return [];
    const wanted = new Set(canonicalKeys);
    return this.bids.filter(
      (bid) => bid.isWinner && wanted.has(canonicalReferenceKey(bid.reference)),
    );
  }

  async participationStats(): Promise<ParticipationStats> {
    // The pure fold carries the behavioral contract; the repository layer only
    // adds the top-N cap the SQL implementation enforces with LIMIT.
    const summary = summarizeParticipation(this.bids);
    return {
      ...summary,
      byBuyer: summary.byBuyer.slice(0, PARTICIPATION_TOP_LIMIT),
      topCompetitors: summary.topCompetitors.slice(0, PARTICIPATION_TOP_LIMIT),
    };
  }

  async listCompetitorStats(): Promise<CompetitorStats[]> {
    return this.competitors
      .map((competitor) => {
        const bids = this.bids.filter((b) => b.competitorId === competitor.id);
        return {
          id: competitor.id,
          canonicalName: competitor.canonicalName,
          wins: bids.filter((b) => b.isWinner).length,
          totalMad: bids.reduce((sum, b) => sum + (b.amountMad ?? 0), 0),
        };
      })
      .sort((a, b) => b.totalMad - a.totalMad);
  }

  async getProfile(competitorId: string): Promise<CompetitorProfile | null> {
    const competitor = this.competitors.find((c) => c.id === competitorId);
    if (!competitor) return null;
    const bids = this.bids.filter((b) => b.competitorId === competitorId);
    return buildCompetitorProfile(competitor, bids);
  }

  async rebateBenchmarks(): Promise<RebateBenchmarks> {
    return summarizeRebates(this.bids.map(bidToObservation));
  }
}

/**
 * SQL twins of the participation.domain JS folds, for the pushed-down
 * participationStats aggregation. Reference: trim + upper + collapse every
 * non-alphanumeric run — mirrors summarizeParticipation's refKey exactly.
 * Bidder: entity-resolved competitor_id, falling back to a folded bidder_name
 * for legacy rows. Buyer: lower + collapse punctuation/whitespace keeping
 * accented letters — Postgres has no unaccent here, so this does not match the
 * JS canonicalBuyerKey character-for-character; it only needs to fold
 * case/punctuation drift together and make the placeholder excludable.
 */
const SQL_REF_KEY = sql`regexp_replace(upper(btrim(reference)), '[^A-Z0-9]+', ' ', 'g')`;
const SQL_BIDDER_KEY = sql`coalesce(competitor_id::text, btrim(regexp_replace(lower(bidder_name), '[^a-z0-9]+', ' ', 'g')))`;
const SQL_BUYER_KEY = sql`btrim(lower(regexp_replace(buyer_name, '[^a-zA-Z0-9À-ÿ]+', ' ', 'g')))`;

export class DrizzleIntelRepository implements IntelRepository {
  constructor(private readonly db: Db) {}

  async upsertCompetitor(rawName: string): Promise<CompetitorRecord> {
    const normalized = normalizeCompanyName(rawName);
    const [existing] = await this.db
      .select()
      .from(competitors)
      .where(eq(competitors.normalizedName, normalized))
      .limit(1);
    if (existing) {
      return {
        id: existing.id,
        canonicalName: existing.canonicalName,
        normalizedName: existing.normalizedName,
      };
    }
    const [row] = await this.db
      .insert(competitors)
      .values({ canonicalName: rawName.trim(), normalizedName: normalized })
      .returning();
    if (!row) throw new Error('Competitor insert returned no row');
    return {
      id: row.id,
      canonicalName: row.canonicalName,
      normalizedName: row.normalizedName,
    };
  }

  async insertResult(
    result: PublishedResult,
    competitorId: string,
  ): Promise<boolean> {
    // Atomic guard on the (reference, competitor_id) unique index: a concurrent
    // writer that beat us to the row makes this a no-op (no returned id) instead
    // of a duplicate, replacing the old SELECT-then-INSERT race.
    const rows = await this.db
      .insert(competitorBids)
      .values(bidInsertValues(result, competitorId))
      .onConflictDoNothing({
        target: [competitorBids.reference, competitorBids.competitorId],
      })
      .returning({ id: competitorBids.id });
    return rows.length > 0;
  }

  async upsertResult(
    result: PublishedResult,
    competitorId: string,
  ): Promise<'inserted' | 'updated'> {
    // One atomic INSERT … ON CONFLICT keyed on the (reference, competitor_id)
    // unique index, so the result-crawler harvest and the PV harvest can race
    // without producing a duplicate row that would double-count a winner in the
    // rebate calibration. The SET clause is back-fill only — identical semantics
    // to the old read-modify-write: a non-null incoming value enriches the row,
    // an incoming null never erases what an earlier crawl learned (COALESCE
    // keeps the existing value), the winner flag is sticky (OR), and a real
    // buyer name replaces the 'Acheteur non précisé' placeholder. `excluded` is
    // the row we tried to insert; the bare column is the row already stored.
    // (xmax = 0) is the Postgres idiom for "this RETURNING row was freshly
    // inserted" — xmax is 0 on a plain INSERT and non-zero after a DO UPDATE.
    const [row] = await this.db
      .insert(competitorBids)
      .values(bidInsertValues(result, competitorId))
      .onConflictDoUpdate({
        target: [competitorBids.reference, competitorBids.competitorId],
        set: {
          buyerName: sql`case when excluded.buyer_name <> ${UNKNOWN_BUYER_LABEL} then excluded.buyer_name else ${competitorBids.buyerName} end`,
          amountMad: sql`coalesce(excluded.amount_mad, ${competitorBids.amountMad})`,
          estimationMad: sql`coalesce(excluded.estimation_mad, ${competitorBids.estimationMad})`,
          objet: sql`coalesce(excluded.objet, ${competitorBids.objet})`,
          isWinner: sql`${competitorBids.isWinner} or excluded.is_winner`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async listResults(limit: number): Promise<CompetitorBidRecord[]> {
    const rows = await this.db
      .select()
      .from(competitorBids)
      .orderBy(desc(competitorBids.createdAt))
      .limit(limit);
    return rows.map(mapBidRow);
  }

  async listAllBids(): Promise<CompetitorBidRecord[]> {
    const rows = await this.db.select().from(competitorBids);
    return rows.map(mapBidRow);
  }

  async findWinnersByReferences(
    canonicalKeys: readonly string[],
  ): Promise<CompetitorBidRecord[]> {
    if (canonicalKeys.length === 0) return [];
    // Fold the stored reference the SAME way canonicalReferenceKey does in TS:
    // lowercase, collapse every non-alphanumeric run to one space, trim. Matching
    // on the canonical key (not the raw reference) means our soumission and the
    // public attribution agree even when case/spacing/punctuation drift, and the
    // query is bounded by the submission set instead of a fixed row ceiling.
    const canonical = sql`btrim(regexp_replace(lower(${competitorBids.reference}), '[^a-z0-9]+', ' ', 'g'))`;
    const rows = await this.db
      .select()
      .from(competitorBids)
      .where(
        and(
          eq(competitorBids.isWinner, true),
          inArray(canonical, [...canonicalKeys]),
        ),
      );
    return rows.map(mapBidRow);
  }

  async participationStats(): Promise<ParticipationStats> {
    // Pushed down to SQL: competitor_bid is heading for 150k-300k rows and the
    // old listAllBids() + summarizeParticipation JS fold would drag every row
    // over the wire on each knowledge/analysis read. Three bounded aggregate
    // queries (per_ref CTE → aggregates) return ~1 + 2×50 rows instead.
    const [globals, byBuyer, topCompetitors] = await Promise.all([
      this.participationGlobals(),
      this.participationByBuyer(),
      this.participationTopCompetitors(),
    ]);
    return { ...globals, byBuyer, topCompetitors };
  }

  private async participationGlobals(): Promise<
    Pick<
      ParticipationStats,
      'resultsObserved' | 'tendersWithResults' | 'avgBiddersPerTender'
    >
  > {
    const result = await this.db.execute<{
      results_observed: string;
      tenders_with_results: string;
      avg_bidders: string | null;
    }>(sql`
      WITH per_ref AS (
        SELECT ${SQL_REF_KEY} AS ref_key,
               count(DISTINCT ${SQL_BIDDER_KEY}) AS bidders
          FROM intel.competitor_bid
         GROUP BY 1
      )
      SELECT (SELECT count(*) FROM intel.competitor_bid) AS results_observed,
             count(*) AS tenders_with_results,
             round(avg(bidders), 1) AS avg_bidders
        FROM per_ref
    `);
    const row = result.rows[0];
    return {
      resultsObserved: Number(row?.results_observed ?? 0),
      tendersWithResults: Number(row?.tenders_with_results ?? 0),
      // avg() over zero references is SQL NULL — same "no data yet" contract
      // as the JS fold.
      avgBiddersPerTender: row?.avg_bidders != null ? Number(row.avg_bidders) : null,
    };
  }

  private async participationByBuyer(): Promise<ParticipationStats['byBuyer']> {
    // Buyer identity is the folded key; the display label is the most frequent
    // raw spelling. The PV crawler's unknown-buyer placeholder is folded the
    // same way and excluded — it is not a buyer identity (see rebate.domain);
    // its consultations still count toward the globals above.
    const result = await this.db.execute<{
      buyer_name: string;
      tenders_observed: string;
      avg_bidders: string;
    }>(sql`
      WITH folded AS (
        SELECT ${SQL_REF_KEY} AS ref_key,
               buyer_name,
               ${SQL_BUYER_KEY} AS buyer_key,
               ${SQL_BIDDER_KEY} AS bidder_key
          FROM intel.competitor_bid
         WHERE ${SQL_BUYER_KEY} <> ''
           AND ${SQL_BUYER_KEY} <> btrim(lower(regexp_replace(${UNKNOWN_BUYER_LABEL}, '[^a-zA-Z0-9À-ÿ]+', ' ', 'g')))
      ),
      per_ref AS (
        SELECT buyer_key, ref_key, count(DISTINCT bidder_key) AS bidders
          FROM folded
         GROUP BY 1, 2
      ),
      stats AS (
        SELECT buyer_key,
               count(*) AS tenders_observed,
               round(avg(bidders), 1) AS avg_bidders
          FROM per_ref
         GROUP BY 1
      ),
      label AS (
        SELECT DISTINCT ON (buyer_key) buyer_key, buyer_name
          FROM (
            SELECT buyer_key, buyer_name, count(*) AS uses
              FROM folded
             GROUP BY 1, 2
          ) names
         ORDER BY buyer_key, uses DESC, buyer_name
      )
      SELECT label.buyer_name, stats.tenders_observed, stats.avg_bidders
        FROM stats
        JOIN label USING (buyer_key)
       ORDER BY stats.tenders_observed DESC, label.buyer_name
       LIMIT ${PARTICIPATION_TOP_LIMIT}
    `);
    return result.rows.map((row) => ({
      buyerName: row.buyer_name,
      tendersObserved: Number(row.tenders_observed),
      avgBidders: Number(row.avg_bidders),
    }));
  }

  private async participationTopCompetitors(): Promise<
    ParticipationStats['topCompetitors']
  > {
    // participations = DISTINCT consultations (duplicate harvests of the same
    // (reference, bidder) pair must not inflate the count); wins/totalWonMad
    // stay row-based like the JS fold — the (reference, competitor_id) unique
    // index keeps winner rows distinct per consultation anyway.
    const result = await this.db.execute<{
      name: string;
      participations: string;
      wins: string;
      total_won_mad: string;
    }>(sql`
      WITH folded AS (
        SELECT ${SQL_REF_KEY} AS ref_key,
               bidder_name,
               ${SQL_BIDDER_KEY} AS bidder_key,
               is_winner,
               amount_mad
          FROM intel.competitor_bid
      ),
      stats AS (
        SELECT bidder_key,
               count(DISTINCT ref_key) AS participations,
               count(*) FILTER (WHERE is_winner) AS wins,
               round(coalesce(sum(amount_mad) FILTER (WHERE is_winner), 0)) AS total_won_mad
          FROM folded
         GROUP BY 1
      ),
      label AS (
        SELECT DISTINCT ON (bidder_key) bidder_key, bidder_name
          FROM (
            SELECT bidder_key, bidder_name, count(*) AS uses
              FROM folded
             GROUP BY 1, 2
          ) names
         ORDER BY bidder_key, uses DESC, bidder_name
      )
      SELECT label.bidder_name AS name,
             stats.participations,
             stats.wins,
             stats.total_won_mad
        FROM stats
        JOIN label USING (bidder_key)
       ORDER BY stats.wins DESC, stats.participations DESC, name
       LIMIT ${PARTICIPATION_TOP_LIMIT}
    `);
    return result.rows.map((row) => ({
      name: row.name,
      participations: Number(row.participations),
      wins: Number(row.wins),
      totalWonMad: Number(row.total_won_mad),
    }));
  }

  async listCompetitorStats(): Promise<CompetitorStats[]> {
    // One grouped query instead of two full scans + a JS join — the bid table
    // grows linearly with the PV harvest, the competitor count with it, so the
    // old O(competitors × bids) filter was the intel page's scaling cliff.
    const totalMad = sql<string>`coalesce(sum(${competitorBids.amountMad}), 0)`;
    const rows = await this.db
      .select({
        id: competitors.id,
        canonicalName: competitors.canonicalName,
        wins: sql<number>`count(*) filter (where ${competitorBids.isWinner})`,
        totalMad,
      })
      .from(competitors)
      .leftJoin(competitorBids, eq(competitorBids.competitorId, competitors.id))
      .groupBy(competitors.id, competitors.canonicalName)
      .orderBy(sql`${totalMad} desc`);
    return rows.map((r) => ({
      id: r.id,
      canonicalName: r.canonicalName,
      wins: Number(r.wins),
      totalMad: Number(r.totalMad),
    }));
  }

  async getProfile(competitorId: string): Promise<CompetitorProfile | null> {
    const [competitor] = await this.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .limit(1);
    if (!competitor) return null;

    const rows = await this.db
      .select()
      .from(competitorBids)
      .where(eq(competitorBids.competitorId, competitorId));
    const bids: CompetitorBidRecord[] = rows.map(mapBidRow);

    return buildCompetitorProfile(
      {
        id: competitor.id,
        canonicalName: competitor.canonicalName,
        normalizedName: competitor.normalizedName,
      },
      bids,
    );
  }

  async rebateBenchmarks(): Promise<RebateBenchmarks> {
    // Only a WINNER bid carrying BOTH an estimation and an amount can ever yield
    // a rebate sample (or a rejected outlier); summarizeRebates skips every other
    // row anyway (non-winners, or missing inputs → recoveredRebatePct null). So
    // filtering them in Postgres is output-preserving and bounds the scan to the
    // relevant subset as the competitor_bid table grows toward its 150-300k ceiling.
    const rows = await this.db
      .select()
      .from(competitorBids)
      .where(
        and(
          eq(competitorBids.isWinner, true),
          isNotNull(competitorBids.estimationMad),
          isNotNull(competitorBids.amountMad),
        ),
      );
    return summarizeRebates(
      rows.map((row) =>
        bidToObservation({
          reference: row.reference,
          buyerName: row.buyerName,
          objet: row.objet ?? undefined,
          estimationMad: row.estimationMad ? Number(row.estimationMad) : undefined,
          amountMad: row.amountMad ? Number(row.amountMad) : undefined,
          isWinner: row.isWinner,
        }),
      ),
    );
  }
}
