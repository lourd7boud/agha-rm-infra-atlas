// pg schema: portal — read-only mirror of the authenticated MPE account.
import {
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ── Portal mirror — read-only image of the authenticated MPE account ─────────
// A faithful, idempotent mirror of what the AGHID CONSTRUCTION account itself
// shows on marchespublics.gov.ma: "Mes réponses" and "Mes cautions". This is
// the company's own ground truth (what WE submitted, what WE locked), distinct
// from the public-portal watch and the competitor intel above.
export const portal = pgSchema('portal');

// "Mes réponses" — one row per soumission we deposited on the portal.
export const portalSubmissions = portal.table(
  'submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    procedure: text('procedure'),
    category: text('category'),
    objet: text('objet'),
    organisme: text('organisme'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // The portal's internal consultation id — the eventual true key, but absent
    // from the listing rows, so nullable until a detail crawl back-fills it.
    consultationId: text('consultation_id'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // reference alone is NOT unique — the same short ref recurs across years and
    // re-issued consultations — so the deadline disambiguates the soumission.
    uniqueIndex('portal_submission_ref_deadline_uniq').on(
      table.reference,
      table.deadlineAt,
    ),
  ],
);

// "Mes cautions" — one row per caution (bank guarantee) requested via the portal.
export const portalCautions = portal.table(
  'caution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    procedure: text('procedure'),
    category: text('category'),
    objet: text('objet'),
    organisme: text('organisme'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    bankName: text('bank_name'),
    intitule: text('intitule'),
    // NOT NULL with a 0 sentinel so it can anchor the unique index (NULL <> NULL
    // would defeat dedup for amount-less brouillon cautions). 0 reads back as
    // "no amount" — see listCautions and the unique-index note below.
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    statut: text('statut'),
    demandeFile: text('demande_file'),
    consultationId: text('consultation_id'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Same recurring-reference caveat as submissions; the amount further
    // distinguishes multiple cautions filed against one consultation.
    //
    // amount_mad is NOT NULL with a 0 default so it can sit in the unique key:
    // a brouillon caution carries no amount yet, and in Postgres NULL <> NULL
    // inside a unique index would let two amount-less rows for the same
    // (reference, deadline) escape the conflict, duplicating on every harvest.
    // The sentinel 0 (a real caution is always a positive guarantee) collapses
    // all amount-less rows for one (reference, deadline) into a single conflict
    // group while preserving distinct positive amounts. listCautions maps 0 back
    // to `undefined` on read, so callers still see "no amount". The repository
    // upsert writes 0 for a missing amount and the in-memory matcher folds the
    // same way, keeping both implementations identical.
    uniqueIndex('portal_caution_ref_deadline_amount_uniq').on(
      table.reference,
      table.deadlineAt,
      table.amountMad,
    ),
  ],
);
