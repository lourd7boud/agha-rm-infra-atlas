import { describe, expect, test, vi } from 'vitest';
import { InMemoryCautionRepository } from '../finance/caution.repository';
import { InMemoryFieldRepository } from '../field/field.repository';
import {
  InMemoryProjectRepository,
  type CreateSituation,
} from '../project/project.repository';
import { InMemoryTenderRepository } from '../tender/tender.repository';
import { InMemoryVaultRepository } from '../vault/vault.repository';
import { DigestService } from './digest.service';
import { InMemoryOutboxRepository } from './outbox.repository';
import { ConsoleTransport } from './transport';

function makeService() {
  const projects = new InMemoryProjectRepository();
  const field = new InMemoryFieldRepository();
  const service = new DigestService(
    new InMemoryTenderRepository(),
    new InMemoryVaultRepository(),
    new InMemoryOutboxRepository(),
    new ConsoleTransport(),
    new InMemoryCautionRepository(),
    projects,
    field,
  );
  return { service, projects, field };
}

function situation(
  projectId: string,
  numero: number,
  avancementPct: number,
): CreateSituation {
  return {
    projectId,
    numero,
    periodEnd: new Date(`2026-0${numero}-28T00:00:00Z`),
    montantCumuleMad: numero * 100_000,
    montantPeriodeMad: 100_000,
    retenueGarantieMad: 0,
    netAPayerMad: 100_000,
    avancementPct,
  };
}

async function enCoursProject(
  projects: InMemoryProjectRepository,
  reference: string,
) {
  const project = await projects.create({
    reference,
    name: `Chantier ${reference}`,
    buyerName: 'Commune X',
    montantMarcheMad: 1_000_000,
  });
  await projects.updateStatus(project.id, 'en_cours');
  return project;
}

describe('DigestService.buildToday — CHANTIERS section', () => {
  test('uses the highest-numero situation for avancement, regardless of insertion order', async () => {
    const { service, projects, field } = makeService();
    const project = await enCoursProject(projects, 'CH-001');

    // Inserted out of order (1, 3, 2): the latest décompte (numero 3) must win.
    await projects.createSituation(situation(project.id, 1, 10));
    await projects.createSituation(situation(project.id, 3, 45));
    await projects.createSituation(situation(project.id, 2, 25));

    await field.createLog({
      projectId: project.id,
      reportDate: new Date('2026-03-20T00:00:00Z'),
      effectifs: 12,
      travauxRealises: 'terrassement',
      incidentsSecurite: 0,
      createdBy: 'chef',
      blocages: 'attente béton',
    });
    await field.createLog({
      projectId: project.id,
      reportDate: new Date('2026-03-21T00:00:00Z'),
      effectifs: 8,
      travauxRealises: 'coffrage',
      incidentsSecurite: 0,
      createdBy: 'chef',
    });

    const { texte } = await service.buildToday();

    expect(texte).toContain('— CHANTIERS —');
    expect(texte).toContain('CH-001: 45% — effectif moyen 10 ⚠ 1 blocage(s)');
  });

  test('falls back to 0% and no alert when a project has no situations or logs', async () => {
    const { service, projects } = makeService();
    await enCoursProject(projects, 'CH-002');

    const { texte } = await service.buildToday();

    expect(texte).toContain('CH-002: 0% — effectif moyen 0');
    expect(texte).not.toContain('⚠');
  });

  test('omits the CHANTIERS section when no project is en_cours', async () => {
    const { service, projects } = makeService();
    // Default status is 'preparation' — should not surface as a chantier.
    await projects.create({
      reference: 'CH-003',
      name: 'Chantier CH-003',
      buyerName: 'Commune X',
      montantMarcheMad: 500_000,
    });

    const { texte } = await service.buildToday();

    expect(texte).not.toContain('— CHANTIERS —');
    expect(texte).not.toContain('CH-003');
  });

  test('fetches situations once for the whole portfolio, never per project (no N+1)', async () => {
    const { service, projects } = makeService();
    const a = await enCoursProject(projects, 'CH-010');
    const b = await enCoursProject(projects, 'CH-011');
    await projects.createSituation(situation(a.id, 1, 30));
    await projects.createSituation(situation(b.id, 1, 60));

    const listAllSpy = vi.spyOn(projects, 'listAllSituations');
    const listSituationsSpy = vi.spyOn(projects, 'listSituations');

    await service.buildToday();

    expect(listAllSpy).toHaveBeenCalledTimes(1);
    expect(listSituationsSpy).not.toHaveBeenCalled();
  });
});
