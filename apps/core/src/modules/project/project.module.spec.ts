import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { InMemoryCautionRepository } from '../finance/caution.repository';
import { InMemoryFinanceLedgerRepository } from '../finance/ledger.repository';
import { InMemoryPeopleRepository } from '../people/people.repository';
import { InMemoryStockRepository } from '../stock/stock.repository';
import { ProjectController } from './project.module';
import { ProjectCostService } from './project-cost.service';
import { InMemoryProjectRepository } from './project.repository';

/**
 * DI bootstrap / wiring regression test for the /projects surface.
 *
 * Production incident: a circular NestJS module dependency (Project ⇄ People and
 * Project ⇄ Finance, both via forwardRef) made Nest instantiate ProjectController
 * BEFORE ProjectCostService resolved, so `this.cost` was injected as `undefined`.
 * Every cost route then crashed with
 *   `TypeError: Cannot read properties of undefined (reading 'costSummary')`.
 * Unit tests passed because they never wired the controller against the cost
 * service — they only tested the in-memory repos / pure domains.
 *
 * @nestjs/testing is not a dependency here (and vitest runs without the Nest
 * decorator-metadata transform), so instead of bootstrapping the DI container we
 * build the REAL ProjectCostService from the REAL in-memory repositories and the
 * REAL ProjectController from that service — exercising the exact wiring that was
 * broken. No mock/fake cost service: the point is to prove the controller's cost
 * dependency is satisfiable and functional end-to-end.
 */
function buildRealController(): {
  controller: ProjectController;
  projects: InMemoryProjectRepository;
} {
  const projects = new InMemoryProjectRepository();
  const stock = new InMemoryStockRepository();
  const people = new InMemoryPeopleRepository();
  const ledger = new InMemoryFinanceLedgerRepository();
  // CautionRepository is constructed for completeness of the finance surface but
  // is not a ProjectCostService dependency; the cost rollup uses the ledger.
  void new InMemoryCautionRepository();

  // Real service with its four real repository dependencies (PROJECT/STOCK/
  // PEOPLE/FINANCE_LEDGER) — the same set ProjectModule wires via DI.
  const cost = new ProjectCostService(projects, stock, people, ledger);
  const controller = new ProjectController(projects, cost);
  return { controller, projects };
}

describe('ProjectController DI wiring (regression: undefined cost service)', () => {
  it('constructs with a real ProjectCostService injected (not undefined)', () => {
    // Arrange + Act
    const { controller } = buildRealController();

    // Assert — the controller exists and its cost dependency is wired.
    expect(controller).toBeDefined();
  });

  it('costSummary() resolves through the real cost service to an array', async () => {
    // Arrange
    const { controller, projects } = buildRealController();
    await projects.create({
      reference: 'AGHA-2026-001',
      name: 'Réfection voirie RN1',
      buyerName: 'Commune de Témara',
      montantMarcheMad: 4_500_000,
    });

    // Act — this is the exact call that crashed in prod (this.cost.costSummary()).
    const summary = await controller.costSummary();

    // Assert — real rollup runs (no TypeError), returns one row per project.
    expect(Array.isArray(summary)).toBe(true);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.budgetMad).toBe(4_500_000);
  });

  it('projectCost(id) resolves end-to-end through the real cost service', async () => {
    // Arrange
    const { controller, projects } = buildRealController();
    const project = await projects.create({
      reference: 'AGHA-2026-002',
      name: 'Assainissement quartier El Menzeh',
      buyerName: 'ONEE',
      montantMarcheMad: 8_000_000,
    });

    // Act
    const cost = await controller.projectCost(project.id);

    // Assert — full breakdown computed via stock/people/ledger reads.
    expect(cost).not.toBeNull();
    expect(cost?.budgetMad).toBe(8_000_000);
    expect(cost?.coutTotalMad).toBe(0);
    expect(cost?.restantMad).toBe(8_000_000);
  });

  it('projectCost(id) maps an unknown project to a 404', async () => {
    // Arrange
    const { controller } = buildRealController();

    // Act + Assert — the service returns null, the controller raises NotFound.
    await expect(
      controller.projectCost('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails loudly at construction if the cost service is nullish', () => {
    // Arrange
    const projects = new InMemoryProjectRepository();

    // Act + Assert — the defensive guard turns the silent undefined-injection
    // regression into an explicit, debuggable boot-time failure.
    expect(
      () =>
        new ProjectController(
          projects,
          undefined as unknown as ProjectCostService,
        ),
    ).toThrow(/ProjectCostService was not injected/);
  });
});
