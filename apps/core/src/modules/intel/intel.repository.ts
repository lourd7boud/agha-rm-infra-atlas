import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { competitorBids, competitors } from '../../db/schema';
import { normalizeFr } from '../tender/qualifier.domain';
import { inferSegment } from '../tender/inventory.domain';
import type { PublishedResult } from './intel.parser';
import { buildCompetitorProfile, type CompetitorProfile } from './intel.profile';
import {
  summarizeRebates,
  UNKNOWN_BUYER_LABEL,
  type RebateBenchmarks,
  type RebateObservation,
} from './rebate.domain';

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

/** Canonical normalization: accents/case/punctuation + legal-form suffixes. */
export function normalizeCompanyName(rawName: string): string {
  return normalizeFr(rawName)
    .replace(/[.,]/g, ' ')
    .replace(/\b(s\s?a\s?r\s?l|sarl|sa|s\s?a|ste|societe|au)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical join key for a market référence. The same market arrives from two
 * independent paths (our authenticated "Mes réponses" listing vs the public
 * result crawler) as short codes like "62/2025/DP A/IF", so case, spacing and
 * punctuation drift. Folding case + collapsing every non-alphanumeric run to a
 * single space keeps both sides agreeing on what "the same market" is. Lives
 * here (next to normalizeCompanyName) so the SQL canonicalizer in
 * findWinnersByReferences and the in-memory matcher share ONE definition with
 * the portal outcome domain, which re-exports it.
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

  async listCompetitorStats(): Promise<CompetitorStats[]> {
    const [allCompetitors, allBids] = await Promise.all([
      this.db.select().from(competitors),
      this.db.select().from(competitorBids),
    ]);
    return allCompetitors
      .map((competitor) => {
        const bids = allBids.filter((b) => b.competitorId === competitor.id);
        return {
          id: competitor.id,
          canonicalName: competitor.canonicalName,
          wins: bids.filter((b) => b.isWinner).length,
          totalMad: bids.reduce(
            (sum, b) => sum + (b.amountMad ? Number(b.amountMad) : 0),
            0,
          ),
        };
      })
      .sort((a, b) => b.totalMad - a.totalMad);
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
    const rows = await this.db.select().from(competitorBids);
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
