import {
  boolean,
  date,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Each ATLAS module owns its PostgreSQL schema (enterprise-architecture §3).
export const vault = pgSchema('vault');
export const tender = pgSchema('tender');
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

export const vaultDocuments = vault.table('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  reference: text('reference'),
  bucket: text('bucket'),
  objectKey: text('object_key'),
  sha256: text('sha256'),
  mime: text('mime'),
  issuedAt: date('issued_at', { mode: 'date' }),
  expiresAt: date('expires_at', { mode: 'date' }),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const intel = pgSchema('intel');

export const competitors = intel.table('competitor', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const competitorBids = intel.table('competitor_bid', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: text('reference').notNull(),
  buyerName: text('buyer_name').notNull(),
  bidderName: text('bidder_name').notNull(),
  competitorId: uuid('competitor_id').references(() => competitors.id),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }),
  isWinner: boolean('is_winner').notNull().default(false),
  resultDate: date('result_date', { mode: 'date' }),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const buyers = tender.table('buyer', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  buyerType: text('buyer_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenders = tender.table('tender', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  reference: text('reference').notNull(),
  buyerId: uuid('buyer_id').references(() => buyers.id),
  buyerName: text('buyer_name').notNull(),
  procedure: text('procedure').notNull(),
  objet: text('objet').notNull(),
  estimationMad: numeric('estimation_mad', { precision: 14, scale: 2 }),
  cautionProvisoireMad: numeric('caution_provisoire_mad', { precision: 14, scale: 2 }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  pipelineState: text('pipeline_state').notNull().default('detected'),
  qualification: jsonb('qualification'),
  sourceUrl: text('source_url'),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
