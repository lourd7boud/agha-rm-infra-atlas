import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { getDb } from '../../db/client';
import { resultNotices } from '../../db/schema';

/**
 * Archive of published result/PV notices — the acquisition half of the
 * historical backfill. Rows are written ONCE by the crawler (OCR text
 * included) and interpreted later at budget pace; id_avis is the portal's
 * own notice id and the idempotency key.
 */

export type NoticeStatus = 'acquired' | 'interpreted' | 'empty' | 'error';

export interface AcquiredNotice {
  annonceType: '4' | '5';
  idAvis: string;
  sourceUrl?: string;
  reference?: string;
  buyerName?: string;
  ocrText?: string;
  bytesSize?: number;
  /** 'acquired' when text is usable, 'empty' when OCR yielded nothing. */
  status?: NoticeStatus;
}

export interface NoticeRecord extends AcquiredNotice {
  id: string;
  status: NoticeStatus;
  error?: string;
  acquiredAt: Date;
  interpretedAt?: Date;
}

export const NOTICE_REPOSITORY = Symbol('NOTICE_REPOSITORY');

export interface NoticeRepository {
  /** Subset of the given detail URLs already archived — pre-fetch skip list. */
  knownSourceUrls(urls: readonly string[]): Promise<Set<string>>;
  /** Insert once; false when the id_avis is already archived. */
  insertAcquired(input: AcquiredNotice): Promise<boolean>;
  listByStatus(status: NoticeStatus, limit: number): Promise<NoticeRecord[]>;
  markStatus(id: string, status: NoticeStatus, error?: string): Promise<void>;
  countsByStatus(): Promise<Record<string, number>>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryNoticeRepository implements NoticeRepository {
  private records: readonly NoticeRecord[] = [];

  async knownSourceUrls(urls: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(urls);
    return new Set(
      this.records
        .map((r) => r.sourceUrl)
        .filter((u): u is string => Boolean(u) && wanted.has(u as string)),
    );
  }

  async insertAcquired(input: AcquiredNotice): Promise<boolean> {
    if (this.records.some((r) => r.idAvis === input.idAvis)) return false;
    this.records = [
      ...this.records,
      {
        ...input,
        id: randomUUID(),
        status: input.status ?? 'acquired',
        acquiredAt: new Date(),
      },
    ];
    return true;
  }

  async listByStatus(status: NoticeStatus, limit: number): Promise<NoticeRecord[]> {
    return this.records.filter((r) => r.status === status).slice(0, limit);
  }

  async markStatus(id: string, status: NoticeStatus, error?: string): Promise<void> {
    this.records = this.records.map((r) =>
      r.id === id
        ? {
            ...r,
            status,
            ...(error !== undefined ? { error } : {}),
            interpretedAt: new Date(),
          }
        : r,
    );
  }

  async countsByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const r of this.records) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }
}

type Db = ReturnType<typeof getDb>;

export class DrizzleNoticeRepository implements NoticeRepository {
  constructor(private readonly db: Db) {}

  async knownSourceUrls(urls: readonly string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const rows = await this.db
      .select({ sourceUrl: resultNotices.sourceUrl })
      .from(resultNotices)
      .where(inArray(resultNotices.sourceUrl, [...urls]));
    return new Set(
      rows.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u)),
    );
  }

  async insertAcquired(input: AcquiredNotice): Promise<boolean> {
    const inserted = await this.db
      .insert(resultNotices)
      .values({
        annonceType: input.annonceType,
        idAvis: input.idAvis,
        sourceUrl: input.sourceUrl ?? null,
        reference: input.reference ?? null,
        buyerName: input.buyerName ?? null,
        ocrText: input.ocrText ?? null,
        bytesSize: input.bytesSize != null ? String(input.bytesSize) : null,
        status: input.status ?? 'acquired',
      })
      .onConflictDoNothing({ target: resultNotices.idAvis })
      .returning({ id: resultNotices.id });
    return inserted.length > 0;
  }

  async listByStatus(status: NoticeStatus, limit: number): Promise<NoticeRecord[]> {
    const rows = await this.db
      .select()
      .from(resultNotices)
      .where(eq(resultNotices.status, status))
      .orderBy(resultNotices.acquiredAt)
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      annonceType: r.annonceType as '4' | '5',
      idAvis: r.idAvis,
      sourceUrl: r.sourceUrl ?? undefined,
      reference: r.reference ?? undefined,
      buyerName: r.buyerName ?? undefined,
      ocrText: r.ocrText ?? undefined,
      bytesSize: r.bytesSize != null ? Number(r.bytesSize) : undefined,
      status: r.status as NoticeStatus,
      error: r.error ?? undefined,
      acquiredAt: r.acquiredAt,
      interpretedAt: r.interpretedAt ?? undefined,
    }));
  }

  async markStatus(id: string, status: NoticeStatus, error?: string): Promise<void> {
    await this.db
      .update(resultNotices)
      .set({
        status,
        error: error ?? null,
        interpretedAt: new Date(),
      })
      .where(eq(resultNotices.id, id));
  }

  async countsByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({
        status: resultNotices.status,
        count: sql<number>`count(*)::int`,
      })
      .from(resultNotices)
      .groupBy(resultNotices.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }
}
