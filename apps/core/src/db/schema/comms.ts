// pg schema: comms — outbound message delivery outbox.
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const comms = pgSchema('comms');

// Delivery outbox — every outbound message is recorded before sending.
// Real transports (SMTP/WhatsApp) activate via env; until then the console
// transport proves the pipeline and the outbox is the audit trail.
export const outbox = comms.table('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('en_attente'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
