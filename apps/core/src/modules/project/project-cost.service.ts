import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_LEDGER_REPOSITORY,
  type FinanceLedgerRepository,
} from '../finance/ledger.repository';
import {
  PEOPLE_REPOSITORY,
  type PeopleRepository,
} from '../people/people.repository';
import {
  STOCK_REPOSITORY,
  type StockRepository,
} from '../stock/stock.repository';
import {
  computeProjectCost,
  mergeCostSummary,
  type ComponentByProject,
  type ProjectBudgetRef,
  type ProjectCost,
  type ProjectCostSummary,
} from './project-cost.domain';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from './project.repository';

/**
 * Project cost rollup service — no new table. Loads each cost component from the
 * division that owns it (materials from stock, main-d'œuvre from people,
 * dépenses + recettes from finance) and folds them against the marché budget via
 * the pure project-cost.domain. Two read shapes:
 *   - costSummary()       → portfolio rollup for the projects list (≈5 queries).
 *   - projectCost(id)     → one chantier's breakdown.
 */
@Injectable()
export class ProjectCostService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projects: ProjectRepository,
    @Inject(STOCK_REPOSITORY)
    private readonly stock: StockRepository,
    @Inject(PEOPLE_REPOSITORY)
    private readonly people: PeopleRepository,
    @Inject(FINANCE_LEDGER_REPOSITORY)
    private readonly ledger: FinanceLedgerRepository,
  ) {}

  /**
   * Portfolio cost rollup: one query per source (projects + four batched
   * aggregates), merged in the pure domain. No per-project N+1 — the whole list
   * costs ~5 queries regardless of project count.
   */
  async costSummary(): Promise<ProjectCostSummary[]> {
    const [projects, materials, labor, expenses, incomes] = await Promise.all([
      this.projects.findAll(),
      this.stock.materialsCostByProject(),
      this.people.laborDuesByProject(),
      this.ledger.expensesByProject(),
      this.ledger.paymentsByProject(),
    ]);

    const budgets: ProjectBudgetRef[] = projects.map((project) => ({
      projectId: project.id,
      montantMarcheMad: project.montantMarcheMad,
    }));
    const materialsByProject: ComponentByProject[] = materials.map((row) => ({
      projectId: row.projectId,
      amountMad: row.costMad,
    }));
    const laborByProject: ComponentByProject[] = labor.map((row) => ({
      projectId: row.projectId,
      amountMad: row.duesMad,
    }));
    const expensesByProject: ComponentByProject[] = expenses.map((row) => ({
      projectId: row.projectId,
      amountMad: row.totalMad,
    }));
    const incomesByProject: ComponentByProject[] = incomes.map((row) => ({
      projectId: row.projectId,
      amountMad: row.totalMad,
    }));

    return mergeCostSummary(
      budgets,
      materialsByProject,
      laborByProject,
      expensesByProject,
      incomesByProject,
    );
  }

  /**
   * One chantier's cost breakdown. Returns null when the project does not exist
   * so the controller can map it to a 404. Reuses the scoped repository reads
   * (projectConsumption / projectLabor / cashflow) — the same valuation as the
   * portfolio rollup, sourced per project.
   */
  async projectCost(projectId: string): Promise<ProjectCost | null> {
    const project = await this.projects.findById(projectId);
    if (!project) return null;

    const [consumption, labor, cashflow] = await Promise.all([
      this.stock.projectConsumption(projectId),
      this.people.projectLabor(projectId),
      this.ledger.cashflow(projectId),
    ]);

    const materialsCostMad = consumption.reduce(
      (sum, line) => sum + line.totalCostMad,
      0,
    );

    return computeProjectCost({
      budgetMad: project.montantMarcheMad,
      materialsCostMad,
      laborCostMad: labor.totalDuesMad,
      expensesMad: cashflow.expensesMad,
      incomesMad: cashflow.incomesMad,
    });
  }
}
