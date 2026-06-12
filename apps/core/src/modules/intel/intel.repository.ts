import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { competitorBids, competitors } from '../../db/schema';
import { normalizeFr } from '../tender/qualifier.domain';
import type { PublishedResult } from './intel.parser';

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
  listResults(limit: number): Promise<CompetitorBidRecord[]>;
  listCompetitorStats(): Promise<CompetitorStats[]>;
}

/** Canonical normalization: accents/case/punctuation + legal-form suffixes. */
export function normalizeCompanyName(rawName: string): string {
  return normalizeFr(rawName)
    .replace(/[.,]/g, ' ')
    .replace(/\b(s\s?a\s?r\s?l|sarl|sa|s\s?a|ste|societe|au)\b/g, ' ')
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

  async listResults(limit: number): Promise<CompetitorBidRecord[]> {
    return [...this.bids]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listCompetitorStats(): Promise<CompetitorStats[]> {
    return this.competitors
      .map((competitor) => {
        const bids = this.bids.filter((b) => b.competitorId === competitor.id);
        return {
          canonicalName: competitor.canonicalName,
          wins: bids.filter((b) => b.isWinner).length,
          totalMad: bids.reduce((sum, b) => sum + (b.amountMad ?? 0), 0),
        };
      })
      .sort((a, b) => b.totalMad - a.totalMad);
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
    const [existing] = await this.db
      .select({ id: competitorBids.id })
      .from(competitorBids)
      .where(
        and(
          eq(competitorBids.reference, result.reference),
          eq(competitorBids.competitorId, competitorId),
        ),
      )
      .limit(1);
    if (existing) return false;

    await this.db.insert(competitorBids).values({
      reference: result.reference,
      buyerName: result.buyerName,
      bidderName: result.bidderName,
      competitorId,
      amountMad: result.amountMad?.toString(),
      isWinner: result.isWinner,
      resultDate: result.resultDate,
      sourceUrl: result.sourceUrl,
    });
    return true;
  }

  async listResults(limit: number): Promise<CompetitorBidRecord[]> {
    const rows = await this.db
      .select()
      .from(competitorBids)
      .orderBy(desc(competitorBids.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      buyerName: row.buyerName,
      bidderName: row.bidderName,
      competitorId: row.competitorId ?? '',
      amountMad: row.amountMad ? Number(row.amountMad) : undefined,
      isWinner: row.isWinner,
      resultDate: row.resultDate ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      createdAt: row.createdAt,
    }));
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
}
