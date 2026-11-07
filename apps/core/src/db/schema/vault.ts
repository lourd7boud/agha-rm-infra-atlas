// pg schema: vault — company document register.
import { sql } from 'drizzle-orm';
import { check, date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const vault = pgSchema('vault');

export const vaultDocuments = vault.table('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  reference: text('reference'),
  bucket: text('bucket'),
  objectKey: text('object_key'),
  filename: text('filename'),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'),
  mime: text('mime'),
  issuedAt: date('issued_at', { mode: 'date' }),
  expiresAt: date('expires_at', { mode: 'date' }),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    'vault_document_size_check',
    sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
  ),
]);
