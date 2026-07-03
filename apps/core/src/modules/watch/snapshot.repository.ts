import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { portalSnapshots } from '../../db/schema';

export interface RecordSnapshot {
  source: string;
  url: string;
  sha256: string;
  bytes: number;
  changed: boolean;
  parsedOk: boolean;
  items: number;
}

export interface SnapshotRecord extends RecordSnapshot {
  id: string;
  fetchedAt: Date;
}

export interface SourceCoverage {
  source: string;
  fetches: number;
  changes: number;
  itemsExtracted: number;
  lastFetchAt: Date | null;
  lastChangeAt: Date | null;
  lastParseOk: boolean | null;
}

export const SNAPSHOT_REPOSITORY = Symbol('SNAPSHOT_REPOSITORY');

export interface SnapshotRepository {
  lastSha(source: string, url: string): Promise<string | null>;
  record(input: RecordSnapshot): Promise<SnapshotRecord>;
  coverage(): Promise<SourceCoverage[]>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemorySnapshotRepository implements SnapshotRepository {
  private records: readonly SnapshotRecord[] = [];

  async lastSha(source: string, url: string): Promise<string | null> {
    const match = [...this.records]
      .reverse()
      .find((r) => r.source === source && r.url === url);
    return match?.sha256 ?? null;
  }

  async record(input: RecordSnapshot): Promise<SnapshotRecord> {
    const record: SnapshotRecord = {
      ...input,
      id: randomUUID(),
      fetchedAt: new Date(),
    };
    this.records = [...this.records, record];
    return record;
  }

  async coverage(): Promise<SourceCoverage[]> {
    const bySource = new Map<string, SnapshotRecord[]>();
    for (const record of this.records) {
      bySource.set(record.source, [
        ...(bySource.get(record.source) ?? []),
        record,
      ]);
    }
    return [...bySource.entries()].map(([source, records]) =>
      buildCoverage(source, records),
    );
  }
}

export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: Db) {}

  async lastSha(source: string, url: string): Promise<string | null> {
    const [row] = await this.db
      .select({ sha256: portalSnapshots.sha256 })
      .from(portalSnapshots)
      .where(
        and(
          eq(portalSnapshots.source, source),
          eq(portalSnapshots.url, url),
        ),
      )
      .orderBy(desc(portalSnapshots.fetchedAt))
      .limit(1);
    return row?.sha256 ?? null;
  }

  async record(input: RecordSnapshot): Promise<SnapshotRecord> {
    const [row] = await this.db
      .insert(portalSnapshots)
      .values(input)
      .returning();
    if (!row) throw new Error('Snapshot insert returned no row');
    return { ...input, id: row.id, fetchedAt: row.fetchedAt };
  }

  async coverage(): Promise<SourceCoverage[]> {
    // In-DB aggregate per source instead of `SELECT *` over the whole append-only
    // portal_snapshot log. That log grows fast under the continuous crawler, so
    // the full scan + JS fold hit the 30s statement_timeout and spiked core CPU,
    // timing out /agents (and, being single-threaded, other pages with it). Now
    // Postgres aggregates and only ONE row per source (a handful) crosses the wire.
    const rows = await this.db
      .select({
        source: portalSnapshots.source,
        fetches: sql<number>`count(*)::int`,
        changes: sql<number>`count(*) filter (where ${portalSnapshots.changed})::int`,
        itemsExtracted: sql<number>`coalesce(sum(${portalSnapshots.items}), 0)::int`,
        lastFetchAt: sql<string>`max(${portalSnapshots.fetchedAt})`,
        lastChangeAt: sql<
          string | null
        >`max(${portalSnapshots.fetchedAt}) filter (where ${portalSnapshots.changed})`,
        lastParseOk: sql<
          boolean | null
        >`(array_agg(${portalSnapshots.parsedOk} order by ${portalSnapshots.fetchedAt} desc))[1]`,
      })
      .from(portalSnapshots)
      .groupBy(portalSnapshots.source);
    return rows.map((row) => ({
      source: row.source,
      fetches: row.fetches,
      changes: row.changes,
      itemsExtracted: row.itemsExtracted,
      lastFetchAt: row.lastFetchAt ? new Date(row.lastFetchAt) : null,
      lastChangeAt: row.lastChangeAt ? new Date(row.lastChangeAt) : null,
      lastParseOk: row.lastParseOk,
    }));
  }
}

function buildCoverage(
  source: string,
  records: SnapshotRecord[],
): SourceCoverage {
  const sorted = [...records].sort(
    (a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime(),
  );
  const last = sorted[sorted.length - 1];
  const lastChange = [...sorted].reverse().find((r) => r.changed);
  return {
    source,
    fetches: records.length,
    changes: records.filter((r) => r.changed).length,
    itemsExtracted: records.reduce((sum, r) => sum + r.items, 0),
    lastFetchAt: last?.fetchedAt ?? null,
    lastChangeAt: lastChange?.fetchedAt ?? null,
    lastParseOk: last?.parsedOk ?? null,
  };
}
