import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, sum } from 'drizzle-orm';
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
  limit?: number;
}

export interface ExpenseFilter {
  category?: ExpenseCategory;
  projectId?: string;
  limit?: number;
}

export const FINANCE_LEDGER_REPOSITORY = Symbol('FINANCE_LEDGER_REPOSITORY');

export interface FinanceLedgerRepository {
  createPayment(input: CreatePayment): Promise<PaymentRecord>;
  listPayments(filter: PaymentFilter): Promise<PaymentRecord[]>;
  createExpense(input: CreateExpense): Promise<ExpenseRecord>;
  listExpenses(filter: ExpenseFilter): Promise<ExpenseRecord[]>;
  expenseSummary(): Promise<ExpenseSummary>;
  cashflow(projectId?: string): Promise<Cashflow>;
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

  async listPayments(filter: PaymentFilter): Promise<PaymentRecord[]> {
    let rows = [...this.paymentRecords].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (filter.projectId) {
      rows = rows.filter((r) => r.projectId === filter.projectId);
    }
    return filter.limit ? rows.slice(0, filter.limit) : rows;
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

  async listExpenses(filter: ExpenseFilter): Promise<ExpenseRecord[]> {
    let rows = [...this.expenseRecords].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (filter.category) {
      rows = rows.filter((r) => r.category === filter.category);
    }
    if (filter.projectId) {
      rows = rows.filter((r) => r.projectId === filter.projectId);
    }
    return filter.limit ? rows.slice(0, filter.limit) : rows;
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

  async listPayments(filter: PaymentFilter): Promise<PaymentRecord[]> {
    const where = filter.projectId
      ? eq(payments.projectId, filter.projectId)
      : undefined;
    const base = this.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt));
    const rows = await (filter.limit ? base.limit(filter.limit) : base);
    return rows.map(toPaymentRecord);
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

  async listExpenses(filter: ExpenseFilter): Promise<ExpenseRecord[]> {
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
    const base = this.db
      .select()
      .from(expenses)
      .where(where)
      .orderBy(desc(expenses.createdAt));
    const rows = await (filter.limit ? base.limit(filter.limit) : base);
    return rows.map(toExpenseRecord);
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
