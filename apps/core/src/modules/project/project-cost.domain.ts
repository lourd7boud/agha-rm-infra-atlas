/**
 * Project cost rollup — pure aggregation of a chantier's real cost against its
 * marché budget. No new table backs this: the three cost components (materials
 * consumed, main-d'œuvre dues, dépenses) are summed elsewhere per project and
 * folded here so the same arithmetic backs the list rollup and the single-project
 * breakdown (recon: one definition, two call sites).
 *
 *   coutTotalMad = materialsCostMad + laborCostMad + expensesMad
 *   restantMad   = budgetMad − coutTotalMad      (remaining budget / margin)
 *   margePct     = budgetMad > 0 ? restantMad / budgetMad × 100 : 0
 *
 * incomesMad (encaissements) is carried through when supplied but never folded
 * into the cost: it is recettes, not a cost component.
 */

/** The cost components of one project, each defaulting to 0 upstream. */
export interface ProjectCostInput {
  budgetMad: number;
  materialsCostMad: number;
  laborCostMad: number;
  expensesMad: number;
  incomesMad?: number;
}

/** A project's computed cost position against its budget. */
export interface ProjectCost {
  budgetMad: number;
  materialsCostMad: number;
  laborCostMad: number;
  expensesMad: number;
  coutTotalMad: number;
  restantMad: number;
  margePct: number;
  incomesMad?: number;
}

/**
 * Computes one project's total cost, remaining budget and margin. Pure: every
 * input is a plain number, so the same call backs both the in-memory and Drizzle
 * paths. margePct is 0 (not NaN) when the budget is 0 — a budget-less chantier
 * has no defined margin rather than an undefined division.
 */
export function computeProjectCost(input: ProjectCostInput): ProjectCost {
  const coutTotalMad =
    input.materialsCostMad + input.laborCostMad + input.expensesMad;
  const restantMad = input.budgetMad - coutTotalMad;
  const margePct =
    input.budgetMad > 0 ? (restantMad / input.budgetMad) * 100 : 0;

  return {
    budgetMad: input.budgetMad,
    materialsCostMad: input.materialsCostMad,
    laborCostMad: input.laborCostMad,
    expensesMad: input.expensesMad,
    coutTotalMad,
    restantMad,
    margePct,
    incomesMad: input.incomesMad,
  };
}

/** A project's budget reference — its id and marché amount. */
export interface ProjectBudgetRef {
  projectId: string;
  montantMarcheMad: number;
}

/** One project-keyed cost component (materials, labor, expenses or incomes). */
export interface ComponentByProject {
  projectId: string;
  amountMad: number;
}

/** A project's cost position, keyed by its id for the portfolio rollup. */
export interface ProjectCostSummary extends ProjectCost {
  projectId: string;
}

/** Sums a project-keyed component list into a lookup, defaulting absent to 0. */
function indexByProject(
  components: readonly ComponentByProject[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const component of components) {
    totals.set(
      component.projectId,
      (totals.get(component.projectId) ?? 0) + component.amountMad,
    );
  }
  return totals;
}

/**
 * Merges the per-project cost components into a portfolio cost rollup. Each
 * project's budget is its montantMarcheMad; a component absent for a project
 * defaults to 0 (a chantier with no consumption/labour/dépenses still surfaces
 * with its full budget remaining). Returns one ProjectCostSummary per project,
 * keyed by projectId — pure, so the service can call it for any store.
 */
export function mergeCostSummary(
  projects: readonly ProjectBudgetRef[],
  materialsByProject: readonly ComponentByProject[],
  laborByProject: readonly ComponentByProject[],
  expensesByProject: readonly ComponentByProject[],
  incomesByProject: readonly ComponentByProject[],
): ProjectCostSummary[] {
  const materials = indexByProject(materialsByProject);
  const labor = indexByProject(laborByProject);
  const expenses = indexByProject(expensesByProject);
  const incomes = indexByProject(incomesByProject);

  return projects.map((project) => {
    const cost = computeProjectCost({
      budgetMad: project.montantMarcheMad,
      materialsCostMad: materials.get(project.projectId) ?? 0,
      laborCostMad: labor.get(project.projectId) ?? 0,
      expensesMad: expenses.get(project.projectId) ?? 0,
      incomesMad: incomes.get(project.projectId) ?? 0,
    });
    return { projectId: project.projectId, ...cost };
  });
}
