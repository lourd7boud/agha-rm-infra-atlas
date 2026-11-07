import { Logger, Module } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '../../db/client';
import { salesAccountingEvents } from '../../db/schema';
import {
  SALES_ACCOUNTING_EVENT_STORE,
  type ReconciliationFilters,
  type SalesAccountingEvent,
  type SalesAccountingEventStore,
} from '../compta/compta-auto-posting.service';

function mapEvent(
  row: typeof salesAccountingEvents.$inferSelect,
): SalesAccountingEvent {
  return {
    id: row.id,
    eventKey: row.eventKey,
    eventType: row.eventType,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    occurredAt: row.occurredAt,
    payload: row.payload,
    status: row.status as SalesAccountingEvent['status'],
    attempts: row.attempts,
    lastErrorCode: row.lastErrorCode ?? undefined,
    lastErrorMessage: row.lastErrorMessage ?? undefined,
    accountingEntryId: row.accountingEntryId ?? undefined,
  };
}

export class DrizzleSalesAccountingEventStore
  implements SalesAccountingEventStore
{
  constructor(private readonly db: Db) {}

  async getEvent(id: string): Promise<SalesAccountingEvent | null> {
    const [row] = await this.db
      .select()
      .from(salesAccountingEvents)
      .where(eq(salesAccountingEvents.id, id))
      .limit(1);
    return row ? mapEvent(row) : null;
  }

  async listReconciliation(
    filters: ReconciliationFilters,
  ): Promise<SalesAccountingEvent[]> {
    const conditions: SQL[] = [];
    if (filters.ids?.length) {
      conditions.push(inArray(salesAccountingEvents.id, filters.ids));
    }
    if (filters.statuses?.length) {
      conditions.push(inArray(salesAccountingEvents.status, filters.statuses));
    }
    if (filters.year) {
      conditions.push(
        sql`extract(year from ${salesAccountingEvents.occurredAt}) = ${filters.year}`,
      );
    }
    const rows = await this.db
      .select()
      .from(salesAccountingEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(salesAccountingEvents.occurredAt);
    return rows.map(mapEvent);
  }

  async markProjected(
    id: string,
    entryId: string,
  ): Promise<SalesAccountingEvent> {
    const [row] = await this.db
      .update(salesAccountingEvents)
      .set({
        status: 'projected',
        accountingEntryId: entryId,
        projectedAt: new Date(),
        attempts: sql`${salesAccountingEvents.attempts} + 1`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(salesAccountingEvents.id, id))
      .returning();
    if (!row) throw new Error('Événement comptable introuvable.');
    return mapEvent(row);
  }

  async markBlocked(
    id: string,
    code: string,
    message: string,
  ): Promise<SalesAccountingEvent> {
    return this.markFailure(id, 'blocked', code, message);
  }

  async markRetryableFailure(
    id: string,
    code: string,
    message: string,
  ): Promise<SalesAccountingEvent> {
    return this.markFailure(id, 'pending', code, message);
  }

  private async markFailure(
    id: string,
    status: 'pending' | 'blocked',
    code: string,
    message: string,
  ): Promise<SalesAccountingEvent> {
    const [row] = await this.db
      .update(salesAccountingEvents)
      .set({
        status,
        accountingEntryId: null,
        projectedAt: null,
        attempts: sql`${salesAccountingEvents.attempts} + 1`,
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(salesAccountingEvents.id, id))
      .returning();
    if (!row) throw new Error('Événement comptable introuvable.');
    return mapEvent(row);
  }
}

const unavailableEventStore = new Proxy({} as SalesAccountingEventStore, {
  get: () => () => Promise.reject(new Error('DATABASE_URL requis pour la réconciliation.')),
});

export const salesAccountingEventStoreProvider = {
  provide: SALES_ACCOUNTING_EVENT_STORE,
  useFactory: (): SalesAccountingEventStore => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleSalesAccountingEventStore(getDb(url));
    new Logger('SalesAccountingEventModule').warn(
      'DATABASE_URL not set — sales accounting event store unavailable',
    );
    return unavailableEventStore;
  },
};

@Module({
  providers: [salesAccountingEventStoreProvider],
  exports: [salesAccountingEventStoreProvider],
})
export class SalesAccountingEventModule {}
