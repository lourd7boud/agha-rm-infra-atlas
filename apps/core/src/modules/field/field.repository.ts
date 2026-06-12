import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { dailyLogs } from '../../db/schema';

export interface CreateDailyLog {
  projectId: string;
  reportDate: Date;
  effectifs: number;
  travauxRealises: string;
  materiel?: string;
  meteo?: string;
  blocages?: string;
  incidentsSecurite: number;
  createdBy: string;
}

export interface DailyLogRecord extends CreateDailyLog {
  id: string;
  createdAt: Date;
}

export const FIELD_REPOSITORY = Symbol('FIELD_REPOSITORY');

export interface FieldRepository {
  createLog(input: CreateDailyLog): Promise<DailyLogRecord>;
  listLogs(projectId: string): Promise<DailyLogRecord[]>;
  findByDate(projectId: string, reportDate: Date): Promise<DailyLogRecord | null>;
}

const sameDay = (a: Date, b: Date): boolean =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryFieldRepository implements FieldRepository {
  private records: readonly DailyLogRecord[] = [];

  async createLog(input: CreateDailyLog): Promise<DailyLogRecord> {
    const record: DailyLogRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.records = [...this.records, record];
    return record;
  }

  async listLogs(projectId: string): Promise<DailyLogRecord[]> {
    return this.records
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime());
  }

  async findByDate(
    projectId: string,
    reportDate: Date,
  ): Promise<DailyLogRecord | null> {
    return (
      this.records.find(
        (r) => r.projectId === projectId && sameDay(r.reportDate, reportDate),
      ) ?? null
    );
  }
}

export class DrizzleFieldRepository implements FieldRepository {
  constructor(private readonly db: Db) {}

  async createLog(input: CreateDailyLog): Promise<DailyLogRecord> {
    const [row] = await this.db
      .insert(dailyLogs)
      .values({
        projectId: input.projectId,
        reportDate: input.reportDate,
        effectifs: input.effectifs,
        travauxRealises: input.travauxRealises,
        materiel: input.materiel,
        meteo: input.meteo,
        blocages: input.blocages,
        incidentsSecurite: input.incidentsSecurite,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error('Daily log insert returned no row');
    return toRecord(row);
  }

  async listLogs(projectId: string): Promise<DailyLogRecord[]> {
    const rows = await this.db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.projectId, projectId))
      .orderBy(desc(dailyLogs.reportDate));
    return rows.map(toRecord);
  }

  async findByDate(
    projectId: string,
    reportDate: Date,
  ): Promise<DailyLogRecord | null> {
    const [row] = await this.db
      .select()
      .from(dailyLogs)
      .where(
        and(
          eq(dailyLogs.projectId, projectId),
          eq(dailyLogs.reportDate, reportDate),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }
}

type DailyLogRow = typeof dailyLogs.$inferSelect;

function toRecord(row: DailyLogRow): DailyLogRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    reportDate: row.reportDate,
    effectifs: row.effectifs,
    travauxRealises: row.travauxRealises,
    materiel: row.materiel ?? undefined,
    meteo: row.meteo ?? undefined,
    blocages: row.blocages ?? undefined,
    incidentsSecurite: row.incidentsSecurite,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
