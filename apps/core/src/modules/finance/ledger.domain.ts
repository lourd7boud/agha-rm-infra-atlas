/**
 * Finance ledger v1 — pure arithmetic over the recettes/dépenses journal:
 * - payments: money IN (encaissements TGR, acomptes, avances)
 * - expenses: money OUT, classified by category
 * No I/O here; the repository delegates summaries to these functions.
 */

/** Closed list of expense categories — validated at the edge and grouped here. */
export const EXPENSE_CATEGORIES = [
  'location_materiel',
  'materiaux',
  'main_oeuvre',
  'carburant',
  'transport',
  'sous_traitance',
  'administratif',
  'taxes',
  'autre',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface PaymentView {
  projectId?: string;
  amountMad: number;
}

export interface ExpenseView {
  category: ExpenseCategory;
  projectId?: string;
  amountMad: number;
}

export interface ExpenseCategoryTotal {
  category: ExpenseCategory;
  count: number;
  totalMad: number;
}

export interface ExpenseSummary {
  byCategory: ExpenseCategoryTotal[];
  totalMad: number;
}

/** Group expenses by category, sorted by spend desc, with a grand total. */
export function summarizeExpensesByCategory(
  expenses: ExpenseView[],
): ExpenseSummary {
  const totals = new Map<ExpenseCategory, ExpenseCategoryTotal>();
  for (const expense of expenses) {
    const current = totals.get(expense.category) ?? {
      category: expense.category,
      count: 0,
      totalMad: 0,
    };
    totals.set(expense.category, {
      category: expense.category,
      count: current.count + 1,
      totalMad: current.totalMad + expense.amountMad,
    });
  }

  const byCategory = [...totals.values()].sort(
    (a, b) => b.totalMad - a.totalMad,
  );

  return {
    byCategory,
    totalMad: byCategory.reduce((sum, row) => sum + row.totalMad, 0),
  };
}

export interface Cashflow {
  incomesMad: number;
  expensesMad: number;
  netMad: number;
}

/** Net cashflow (in − out); filtered to a single chantier when projectId given. */
export function projectCashflow(
  payments: PaymentView[],
  expenses: ExpenseView[],
  projectId?: string,
): Cashflow {
  const inScope = <T extends { projectId?: string }>(rows: T[]): T[] =>
    projectId ? rows.filter((r) => r.projectId === projectId) : rows;

  const incomesMad = inScope(payments).reduce((sum, p) => sum + p.amountMad, 0);
  const expensesMad = inScope(expenses).reduce((sum, e) => sum + e.amountMad, 0);

  return { incomesMad, expensesMad, netMad: incomesMad - expensesMad };
}
