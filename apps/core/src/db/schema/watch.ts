// pg schema: watch — portal fetch snapshots (crawler audit trail).
import {
  boolean,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const watch = pgSchema('watch');

// Every portal fetch is recorded; raw HTML is archived when content
// changes (sha256) so extractions are auditable and re-parsable without
// re-crawling. Coverage reporting reads this table.
export const portalSnapshots = watch.table('portal_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  changed: boolean('changed').notNull(),
  parsedOk: boolean('parsed_ok').notNull().default(false),
  items: integer('items').notNull().default(0),
  objectKey: text('object_key'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
