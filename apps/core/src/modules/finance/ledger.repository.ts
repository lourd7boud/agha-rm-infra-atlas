import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNotNull, sum } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { expenses, payments } from '../../db/schema';
import {
  projectCashflow,
  summarizeExpensesByCategory,
  type Cashflow,
  type ExpenseCategory,
  type ExpenseCategoryTotal,
  type ExpenseSummary,
} from './ledger.domain';

/** Per-project ledger total (dépenses or recettes) summed for one chantier. */
export interface TotalByProject {
  projectId: string;
  totalMad: number;
}

export interface CreatePayment {
  projectId?: string;
  label: string;
  payerName?: string;
  amountMad: number;
  method: string;
  transferReference?: string;
  bankName?: string;
  paidAt: Date;
  notes?: string;
}

export interface PaymentRecord extends CreatePayment {
  id: string;
  createdAt: Date;
}

export interface CreateExpense {
  projectId?: string;
  category: ExpenseCategory;
  label: string;
  amountMad: number;
  method?: string;
  reference?: string;
  supplierId?: string;
  spentAt: Date;
  notes?: string;
}

export interface ExpenseRecord extends CreateExpense {
  id: string;
  createdAt: Date;
}

export interface PaymentFilter {
  projectId?: string;
}

export interface ExpenseFilter {
  category?: ExpenseCategory;
  projectId?: string;
}

// ── Pagination (datao-parity: DB-side LIMIT/OFFSET; totals via count(*)) ──────

/** DB-side page window. limit is bounded by the controller (default 25/max 100). */
export interface PageParams {
  limit: number;
  offset: number;
}

/** A single page plus the total matching-row count (for the pager). */
export interface Paged<T> {
  items: T[];
  total: number;
}

export const FINANCE_LEDGER_REPOSITORY = Symbol('FINANCE_LEDGER_REPOSITORY');

export interface FinanceLedgerRepository {
  createPayment(input: CreatePayment): Promise<PaymentRecord>;
  /** One DB page of recettes (newest first) + the total matching count. */
  listPayments(
    filter: PaymentFilter,
    paging: PageParams,
  ): Promise<Paged<PaymentRecord>>;
  createExpense(input: CreateExpense): Promise<ExpenseRecord>;
  /** One DB page of dépenses (newest first) + the total matching count. */
  listExpenses(
    filter: ExpenseFilter,
    paging: PageParams,
  ): Promise<Paged<ExpenseRecord>>;
  expenseSummary(): Promise<ExpenseSummary>;
  cashflow(projectId?: string): Promise<Cashflow>;
  /**
   * Dépenses summed per chantier, for every project at once — the expenses
   * component of the portfolio cost rollup. One GROUP BY project_id query
   * (project_id NOT NULL); projects with no dépenses do not appear and the cost
   * domain defaults them to 0.
   */
  expensesByProject(): Promise<TotalByProject[]>;
  /**
   * Recettes (encaissements) summed per chantier, for every project at once —
   * carried into the cost rollup as incomes (not a cost component). One GROUP BY
   * project_id query (project_id NOT NULL).
   */
  paymentsByProject(): Promise<TotalByProject[]>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryFinanceLedgerRepository implements FinanceLedgerRepository {
  private paymentRecords: readonly PaymentRecord[] = [];
  private expenseRecords: readonly ExpenseRecord[] = [];

  async createPayment(input: CreatePayment): Promise<PaymentRecord> {
    const record: PaymentRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.paymentRecords = [...this.paymentRecords, record];
    return record;
  }

  async listPayments(
    filter: PaymentFilter,
    paging: PageParams,
  ): Promise<Paged<PaymentRecord>> {
    const matched = [...this.paymentRecords]
      .filter((r) => !filter.projectId || r.projectId === filter.projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = matched.slice(paging.offset, paging.offset + paging.limit);
    return { items, total: matched.length };
  }

  async createExpense(input: CreateExpense): Promise<ExpenseRecord> {
    const record: ExpenseRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.expenseRecords = [...this.expenseRecords, record];
    return record;
  }

  async listExpenses(
    filter: ExpenseFilter,
    paging: PageParams,
  ): Promise<Paged<ExpenseRecord>> {
    const matched = [...this.expenseRecords]
      .filter((r) => !filter.category || r.category === filter.category)
      .filter((r) => !filter.projectId || r.projectId === filter.projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = matched.slice(paging.offset, paging.offset + paging.limit);
    return { items, total: matched.length };
  }

  async expenseSummary(): Promise<ExpenseSummary> {
    return summarizeExpensesByCategory(this.expenseRecords as ExpenseRecord[]);
  }

  async cashflow(projectId?: string): Promise<Cashflow> {
    return projectCashflow(
      this.paymentRecords as PaymentRecord[],
      this.expenseRecords as ExpenseRecord[],
      projectId,
    );
  }

  async expensesByProject(): Promise<TotalByProject[]> {
    return sumByProject(this.expenseRecords);
  }

  async paymentsByProject(): Promise<TotalByProject[]> {
    return sumByProject(this.paymentRecords);
  }
}

/** Folds project-scoped ledger rows into one total per project (skips null). */
function sumByProject(
  rows: readonly { projectId?: string; amountMad: number }[],
): TotalByProject[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.projectId) continue;
    totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + row.amountMad);
  }
  return [...totals.entries()].map(([projectId, totalMad]) => ({
    projectId,
    totalMad,
  }));
}

export class DrizzleFinanceLedgerRepository implements FinanceLedgerRepository {
  constructor(private readonly db: Db) {}

  async createPayment(input: CreatePayment): Promise<PaymentRecord> {
    const [row] = await this.db
      .insert(payments)
      .values({
        projectId: input.projectId,
        label: input.label,
        payerName: input.payerName,
        amountMad: input.amountMad.toString(),
        method: input.method,
        transferReference: input.transferReference,
        bankName: input.bankName,
        paidAt: input.paidAt,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Payment insert returned no row');
    return toPaymentRecord(row);
  }

  async listPayments(
    filter: PaymentFilter,
    paging: PageParams,
  ): Promise<Paged<PaymentRecord>> {
    // DB-side page: newest first, LIMIT/OFFSET — plus a count of the whole
    // filtered set so the pager knows how many pages exist. payments are flat
    // rows (no child array), so no projection is needed.
    const where = filter.projectId
      ? eq(payments.projectId, filter.projectId)
      : undefined;
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(payments)
        .where(where)
        .orderBy(desc(payments.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: count() }).from(payments).where(where),
    ]);
    return {
      items: rows.map(toPaymentRecord),
      total: Number(countRow?.total ?? 0),
    };
  }

  async createExpense(input: CreateExpense): Promise<ExpenseRecord> {
    const [row] = await this.db
      .insert(expenses)
      .values({
        projectId: input.projectId,
        category: input.category,
        label: input.label,
        amountMad: input.amountMad.toString(),
        method: input.method,
        reference: input.reference,
        supplierId: input.supplierId,
        spentAt: input.spentAt,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Expense insert returned no row');
    return toExpenseRecord(row);
  }

  async listExpenses(
    filter: ExpenseFilter,
    paging: PageParams,
  ): Promise<Paged<ExpenseRecord>> {
    // DB-side page: newest first, LIMIT/OFFSET + count(*) over the whole filtered
    // set (category and/or project scope). Expenses are flat rows — no projection.
    const conditions = [
      filter.category ? eq(expenses.category, filter.category) : undefined,
      filter.projectId ? eq(expenses.projectId, filter.projectId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(expenses)
        .where(where)
        .orderBy(desc(expenses.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ total: count() }).from(expenses).where(where),
    ]);
    return {
      items: rows.map(toExpenseRecord),
      total: Number(countRow?.total ?? 0),
    };
  }

  async expenseSummary(): Promise<ExpenseSummary> {
    // Aggregate in SQL (GROUP BY category) instead of loading every row into
    // Node — the by-category index backs this and only one row per category
    // crosses the wire.
    const rows = await this.db
      .select({
        category: expenses.category,
        count: count(),
        totalMad: sum(expenses.amountMad),
      })
      .from(expenses)
      .groupBy(expenses.category);

    const byCategory: ExpenseCategoryTotal[] = rows
      .map((row) => ({
        category: row.category as ExpenseCategory,
        count: Number(row.count),
        // sum() of a numeric column comes back as a string (or null when empty).
        totalMad: Number(row.totalMad ?? 0),
      }))
      .sort((a, b) => b.totalMad - a.totalMad);

    return {
      byCategory,
      totalMad: byCategory.reduce((acc, row) => acc + row.totalMad, 0),
    };
  }

  async cashflow(projectId?: string): Promise<Cashflow> {
    // Push the optional project scope into SQL and sum there — no full-table
    // scan into Node memory. payment_project_id_idx / expense_project_id_idx
    // back the scoped reads.
    const paymentWhere = projectId
      ? eq(payments.projectId, projectId)
      : undefined;
    const expenseWhere = projectId
      ? eq(expenses.projectId, projectId)
      : undefined;

    const [paymentAgg, expenseAgg] = await Promise.all([
      this.db
        .select({ total: sum(payments.amountMad) })
        .from(payments)
        .where(paymentWhere),
      this.db
        .select({ total: sum(expenses.amountMad) })
        .from(expenses)
        .where(expenseWhere),
    ]);

    const incomesMad = Number(paymentAgg[0]?.total ?? 0);
    const expensesMad = Number(expenseAgg[0]?.total ?? 0);
    return { incomesMad, expensesMad, netMad: incomesMad - expensesMad };
  }

  async expensesByProject(): Promise<TotalByProject[]> {
    // One GROUP BY project_id query (project_id NOT NULL), summed in SQL —
    // expense_project_id_idx backs the filter/grouping, only one row per project
    // crosses the wire. Unscoped (whole portfolio) — the cost rollup defaults
    // absent projects to 0.
    const rows = await this.db
      .select({
        projectId: expenses.projectId,
        totalMad: sum(expenses.amountMad),
      })
      .from(expenses)
      .where(isNotNull(expenses.projectId))
      .groupBy(expenses.projectId);
    return toTotalsByProject(rows);
  }

  async paymentsByProject(): Promise<TotalByProject[]> {
    // Mirror expensesByProject for recettes — payment_project_id_idx backs it.
    const rows = await this.db
      .select({
        projectId: payments.projectId,
        totalMad: sum(payments.amountMad),
      })
      .from(payments)
      .where(isNotNull(payments.projectId))
      .groupBy(payments.projectId);
    return toTotalsByProject(rows);
  }
}

/** Shapes a GROUP BY project_id aggregate into TotalByProject (skips null id). */
function toTotalsByProject(
  rows: readonly { projectId: string | null; totalMad: string | null }[],
): TotalByProject[] {
  return rows.flatMap((row) =>
    row.projectId
      ? [{ projectId: row.projectId, totalMad: Number(row.totalMad ?? 0) }]
      : [],
  );
}

type PaymentRow = typeof payments.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;

function toPaymentRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    label: row.label,
    payerName: row.payerName ?? undefined,
    amountMad: Number(row.amountMad),
    method: row.method,
    transferReference: row.transferReference ?? undefined,
    bankName: row.bankName ?? undefined,
    paidAt: row.paidAt,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

function toExpenseRecord(row: ExpenseRow): ExpenseRecord {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    category: row.category as ExpenseCategory,
    label: row.label,
    amountMad: Number(row.amountMad),
    method: row.method ?? undefined,
    reference: row.reference ?? undefined,
    supplierId: row.supplierId ?? undefined,
    spentAt: row.spentAt,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}
