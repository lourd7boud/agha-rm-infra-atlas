// pg schema: audit — append-only request/action log.
import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const audit = pgSchema('audit');

// Append-only: no update/delete path exists in application code.
export const auditLog = audit.table('log', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  outcome: text('outcome').notNull(),
  payload: jsonb('payload'),
});
