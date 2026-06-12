import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
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
      .where(eq(portalSnapshots.url, url))
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
    const rows = await this.db.select().from(portalSnapshots);
    const bySource = new Map<string, SnapshotRecord[]>();
    for (const row of rows) {
      const record: SnapshotRecord = {
        id: row.id,
        source: row.source,
        url: row.url,
        sha256: row.sha256,
        bytes: row.bytes,
        changed: row.changed,
        parsedOk: row.parsedOk,
        items: row.items,
        fetchedAt: row.fetchedAt,
      };
      bySource.set(row.source, [...(bySource.get(row.source) ?? []), record]);
    }
    return [...bySource.entries()].map(([source, records]) =>
      buildCoverage(source, records),
    );
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
