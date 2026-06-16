import { randomUUID } from 'node:crypto';
import { desc, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { portalCautions, portalSubmissions } from '../../db/schema';

// ── Records ──────────────────────────────────────────────────────────────────
// One record per row of the authenticated account's own pages. Numerics are
// surfaced as numbers here (stored as strings in Postgres, like the intel repo).

export interface PortalSubmissionRecord {
  id: string;
  reference: string;
  procedure?: string;
  category?: string;
  objet?: string;
  organisme?: string;
  deadlineAt?: Date;
  submittedAt?: Date;
  withdrawnAt?: Date;
  consultationId?: string;
  raw?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortalCautionRecord {
  id: string;
  reference: string;
  procedure?: string;
  category?: string;
  objet?: string;
  organisme?: string;
  deadlineAt?: Date;
  bankName?: string;
  intitule?: string;
  amountMad?: number;
  statut?: string;
  demandeFile?: string;
  consultationId?: string;
  raw?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ── Inputs ───────────────────────────────────────────────────────────────────
// What a crawl yields for one listing row, before identity/timestamps.

export interface PortalSubmissionInput {
  reference: string;
  procedure?: string;
  category?: string;
  objet?: string;
  organisme?: string;
  deadlineAt?: Date;
  submittedAt?: Date;
  withdrawnAt?: Date;
  consultationId?: string;
  raw?: unknown;
}

export interface PortalCautionInput {
  reference: string;
  procedure?: string;
  category?: string;
  objet?: string;
  organisme?: string;
  deadlineAt?: Date;
  bankName?: string;
  intitule?: string;
  amountMad?: number;
  statut?: string;
  demandeFile?: string;
  consultationId?: string;
  raw?: unknown;
}

export const PORTAL_REPOSITORY = Symbol('PORTAL_REPOSITORY');

export interface PortalRepository {
  /**
   * Inserts a soumission, or — when (reference, deadlineAt) already exists —
   * back-fills it: a non-null incoming field enriches the row, an incoming null
   * never erases what an earlier crawl learned. Idempotent. Keyed on the
   * portal_submission_ref_deadline_uniq index. Returns the action taken.
   */
  upsertSubmission(
    input: PortalSubmissionInput,
  ): Promise<'inserted' | 'updated'>;
  /**
   * Inserts a caution, or — when (reference, deadlineAt, amountMad) already
   * exists — back-fills it with the same null-never-erases semantics. Idempotent.
   * Keyed on the portal_caution_ref_deadline_amount_uniq index.
   */
  upsertCaution(input: PortalCautionInput): Promise<'inserted' | 'updated'>;
  listSubmissions(limit: number): Promise<PortalSubmissionRecord[]>;
  listCautions(limit: number): Promise<PortalCautionRecord[]>;
}

// ── Match helpers ──────────────────────────────────────────────────────────
// Mirror the unique-index columns exactly. Two undefined deadlines compare
// equal here (an in-memory convenience); Postgres treats NULLs as distinct, but
// the listing rows always carry a deadline in practice, so the two agree.

function sameDeadline(a?: Date, b?: Date): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.getTime() === b.getTime();
}

/** Drizzle insert row for a submission (numerics N/A; dates pass through). */
function submissionInsertValues(input: PortalSubmissionInput) {
  return {
    reference: input.reference,
    procedure: input.procedure,
    category: input.category,
    objet: input.objet,
    organisme: input.organisme,
    deadlineAt: input.deadlineAt,
    submittedAt: input.submittedAt,
    withdrawnAt: input.withdrawnAt,
    consultationId: input.consultationId,
    raw: input.raw,
  };
}

/** Drizzle insert row for a caution (amount stored as string). */
function cautionInsertValues(input: PortalCautionInput) {
  return {
    reference: input.reference,
    procedure: input.procedure,
    category: input.category,
    objet: input.objet,
    organisme: input.organisme,
    deadlineAt: input.deadlineAt,
    bankName: input.bankName,
    intitule: input.intitule,
    amountMad: input.amountMad?.toString(),
    statut: input.statut,
    demandeFile: input.demandeFile,
    consultationId: input.consultationId,
    raw: input.raw,
  };
}

export class InMemoryPortalRepository implements PortalRepository {
  private submissions: readonly PortalSubmissionRecord[] = [];
  private cautions: readonly PortalCautionRecord[] = [];

  async upsertSubmission(
    input: PortalSubmissionInput,
  ): Promise<'inserted' | 'updated'> {
    const index = this.submissions.findIndex(
      (row) =>
        row.reference === input.reference &&
        sameDeadline(row.deadlineAt, input.deadlineAt),
    );
    const now = new Date();
    if (index === -1) {
      this.submissions = [
        ...this.submissions,
        { ...input, id: randomUUID(), createdAt: now, updatedAt: now },
      ];
      return 'inserted';
    }
    const existing = this.submissions[index]!;
    // Back-fill only: incoming non-null enriches, incoming null keeps existing.
    const merged: PortalSubmissionRecord = {
      ...existing,
      procedure: input.procedure ?? existing.procedure,
      category: input.category ?? existing.category,
      objet: input.objet ?? existing.objet,
      organisme: input.organisme ?? existing.organisme,
      submittedAt: input.submittedAt ?? existing.submittedAt,
      withdrawnAt: input.withdrawnAt ?? existing.withdrawnAt,
      consultationId: input.consultationId ?? existing.consultationId,
      raw: input.raw ?? existing.raw,
      updatedAt: now,
    };
    this.submissions = [
      ...this.submissions.slice(0, index),
      merged,
      ...this.submissions.slice(index + 1),
    ];
    return 'updated';
  }

  async upsertCaution(
    input: PortalCautionInput,
  ): Promise<'inserted' | 'updated'> {
    const index = this.cautions.findIndex(
      (row) =>
        row.reference === input.reference &&
        sameDeadline(row.deadlineAt, input.deadlineAt) &&
        row.amountMad === input.amountMad,
    );
    const now = new Date();
    if (index === -1) {
      this.cautions = [
        ...this.cautions,
        { ...input, id: randomUUID(), createdAt: now, updatedAt: now },
      ];
      return 'inserted';
    }
    const existing = this.cautions[index]!;
    const merged: PortalCautionRecord = {
      ...existing,
      procedure: input.procedure ?? existing.procedure,
      category: input.category ?? existing.category,
      objet: input.objet ?? existing.objet,
      organisme: input.organisme ?? existing.organisme,
      bankName: input.bankName ?? existing.bankName,
      intitule: input.intitule ?? existing.intitule,
      statut: input.statut ?? existing.statut,
      demandeFile: input.demandeFile ?? existing.demandeFile,
      consultationId: input.consultationId ?? existing.consultationId,
      raw: input.raw ?? existing.raw,
      updatedAt: now,
    };
    this.cautions = [
      ...this.cautions.slice(0, index),
      merged,
      ...this.cautions.slice(index + 1),
    ];
    return 'updated';
  }

  async listSubmissions(limit: number): Promise<PortalSubmissionRecord[]> {
    return [...this.submissions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listCautions(limit: number): Promise<PortalCautionRecord[]> {
    return [...this.cautions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export class DrizzlePortalRepository implements PortalRepository {
  constructor(private readonly db: Db) {}

  async upsertSubmission(
    input: PortalSubmissionInput,
  ): Promise<'inserted' | 'updated'> {
    // One atomic INSERT … ON CONFLICT keyed on the (reference, deadline_at)
    // unique index. The SET clause is back-fill only — a non-null incoming
    // value enriches the row (COALESCE prefers `excluded`), an incoming null
    // never erases what an earlier crawl learned (COALESCE keeps the stored
    // column). `excluded` is the row we tried to insert; the bare column is the
    // row already stored. updated_at always advances. (xmax = 0) is the Postgres
    // idiom for "this RETURNING row was freshly inserted".
    const [row] = await this.db
      .insert(portalSubmissions)
      .values(submissionInsertValues(input))
      .onConflictDoUpdate({
        target: [portalSubmissions.reference, portalSubmissions.deadlineAt],
        set: {
          procedure: sql`coalesce(excluded.procedure, ${portalSubmissions.procedure})`,
          category: sql`coalesce(excluded.category, ${portalSubmissions.category})`,
          objet: sql`coalesce(excluded.objet, ${portalSubmissions.objet})`,
          organisme: sql`coalesce(excluded.organisme, ${portalSubmissions.organisme})`,
          submittedAt: sql`coalesce(excluded.submitted_at, ${portalSubmissions.submittedAt})`,
          withdrawnAt: sql`coalesce(excluded.withdrawn_at, ${portalSubmissions.withdrawnAt})`,
          consultationId: sql`coalesce(excluded.consultation_id, ${portalSubmissions.consultationId})`,
          raw: sql`coalesce(excluded.raw, ${portalSubmissions.raw})`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async upsertCaution(
    input: PortalCautionInput,
  ): Promise<'inserted' | 'updated'> {
    // Same back-fill-only contract as submissions, keyed on the
    // (reference, deadline_at, amount_mad) unique index.
    const [row] = await this.db
      .insert(portalCautions)
      .values(cautionInsertValues(input))
      .onConflictDoUpdate({
        target: [
          portalCautions.reference,
          portalCautions.deadlineAt,
          portalCautions.amountMad,
        ],
        set: {
          procedure: sql`coalesce(excluded.procedure, ${portalCautions.procedure})`,
          category: sql`coalesce(excluded.category, ${portalCautions.category})`,
          objet: sql`coalesce(excluded.objet, ${portalCautions.objet})`,
          organisme: sql`coalesce(excluded.organisme, ${portalCautions.organisme})`,
          bankName: sql`coalesce(excluded.bank_name, ${portalCautions.bankName})`,
          intitule: sql`coalesce(excluded.intitule, ${portalCautions.intitule})`,
          statut: sql`coalesce(excluded.statut, ${portalCautions.statut})`,
          demandeFile: sql`coalesce(excluded.demande_file, ${portalCautions.demandeFile})`,
          consultationId: sql`coalesce(excluded.consultation_id, ${portalCautions.consultationId})`,
          raw: sql`coalesce(excluded.raw, ${portalCautions.raw})`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async listSubmissions(limit: number): Promise<PortalSubmissionRecord[]> {
    const rows = await this.db
      .select()
      .from(portalSubmissions)
      .orderBy(desc(portalSubmissions.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      procedure: row.procedure ?? undefined,
      category: row.category ?? undefined,
      objet: row.objet ?? undefined,
      organisme: row.organisme ?? undefined,
      deadlineAt: row.deadlineAt ?? undefined,
      submittedAt: row.submittedAt ?? undefined,
      withdrawnAt: row.withdrawnAt ?? undefined,
      consultationId: row.consultationId ?? undefined,
      raw: row.raw ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async listCautions(limit: number): Promise<PortalCautionRecord[]> {
    const rows = await this.db
      .select()
      .from(portalCautions)
      .orderBy(desc(portalCautions.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      procedure: row.procedure ?? undefined,
      category: row.category ?? undefined,
      objet: row.objet ?? undefined,
      organisme: row.organisme ?? undefined,
      deadlineAt: row.deadlineAt ?? undefined,
      bankName: row.bankName ?? undefined,
      intitule: row.intitule ?? undefined,
      amountMad: row.amountMad ? Number(row.amountMad) : undefined,
      statut: row.statut ?? undefined,
      demandeFile: row.demandeFile ?? undefined,
      consultationId: row.consultationId ?? undefined,
      raw: row.raw ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
