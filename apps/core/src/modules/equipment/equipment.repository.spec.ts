import { beforeEach, describe, expect, test } from 'vitest';
import { EquipmentTransitionError } from './equipment.domain';
import { InMemoryEquipmentRepository } from './equipment.repository';

const ACQUIRED_AT = new Date('2024-03-15T00:00:00Z');
const ASSIGNED_AT = new Date('2026-06-21T00:00:00Z');
const RETURN_AT = new Date('2026-09-30T00:00:00Z');
const PROJECT_A = 'project-A';
const PROJECT_B = 'project-B';
// A page window wide enough that the small fixtures below never spill a page —
// listEquipment is now DB-side paginated and returns a Paged<EquipmentRecord>.
const PAGE = { limit: 100, offset: 0 };

describe('InMemoryEquipmentRepository — upsert & list', () => {
  let repo: InMemoryEquipmentRepository;
  beforeEach(() => {
    repo = new InMemoryEquipmentRepository();
  });

  test('upsertEquipment inserts a new machine as disponible', async () => {
    // Arrange + Act
    const machine = await repo.upsertEquipment({
      name: 'Pelle hydraulique CAT 320',
      code: 'PELLE-01',
      category: 'engin',
      acquisitionDate: ACQUIRED_AT,
    });

    // Assert
    expect(machine.id).toBeTruthy();
    expect(machine.status).toBe('disponible');
    expect(machine.code).toBe('PELLE-01');
  });

  test('upsertEquipment on the same name back-fills without duplicating', async () => {
    // Arrange
    const first = await repo.upsertEquipment({ name: 'Compacteur BOMAG' });

    // Act
    const second = await repo.upsertEquipment({
      name: 'Compacteur BOMAG',
      code: 'COMP-02',
    });
    const all = await repo.listEquipment({}, PAGE);

    // Assert
    expect(second.id).toBe(first.id);
    expect(second.code).toBe('COMP-02');
    expect(all.items).toHaveLength(1);
    expect(all.total).toBe(1);
  });

  test('listEquipment filters by status', async () => {
    // Arrange
    const idle = await repo.upsertEquipment({ name: 'Bétonnière 1' });
    await repo.upsertEquipment({ name: 'Bétonnière 2' });
    await repo.setEquipmentStatus(idle.id, 'hors_service');

    // Act
    const broken = await repo.listEquipment({ status: 'hors_service' }, PAGE);
    const available = await repo.listEquipment({ status: 'disponible' }, PAGE);

    // Assert
    expect(broken.items).toHaveLength(1);
    expect(broken.items[0]?.id).toBe(idle.id);
    expect(available.items).toHaveLength(1);
  });

  test('listEquipment slices to the page window and reports the full total', async () => {
    // Arrange — three machines, ask for a 2-per-page window.
    await repo.upsertEquipment({ name: 'Engin 1' });
    await repo.upsertEquipment({ name: 'Engin 2' });
    await repo.upsertEquipment({ name: 'Engin 3' });

    // Act
    const first = await repo.listEquipment({}, { limit: 2, offset: 0 });
    const second = await repo.listEquipment({}, { limit: 2, offset: 2 });

    // Assert — total is the whole set on every page; items are the slice.
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  test('equipmentSummary tallies status over the whole parc, not one page', async () => {
    // Arrange — 2 disponible, 1 hors_service.
    await repo.upsertEquipment({ name: 'Dispo 1' });
    await repo.upsertEquipment({ name: 'Dispo 2' });
    const broken = await repo.upsertEquipment({ name: 'Cassée' });
    await repo.setEquipmentStatus(broken.id, 'hors_service');

    // Act — summary takes no paging; it counts the entire table.
    const summary = await repo.equipmentSummary();

    // Assert
    expect(summary.total).toBe(3);
    expect(summary.counts.disponible).toBe(2);
    expect(summary.counts.hors_service).toBe(1);
    expect(summary.counts.assignee).toBe(0);
  });
});

describe('InMemoryEquipmentRepository — assign / return', () => {
  let repo: InMemoryEquipmentRepository;
  beforeEach(() => {
    repo = new InMemoryEquipmentRepository();
  });

  test('assignEquipment sets status to assignee and opens an assignment', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Niveleuse' });

    // Act
    const assignment = await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
      expectedReturnAt: RETURN_AT,
    });
    const detail = await repo.getEquipment(machine.id);

    // Assert
    expect(assignment.returnedAt).toBeUndefined();
    expect(assignment.expectedReturnAt).toEqual(RETURN_AT);
    expect(detail?.equipment.status).toBe('assignee');
    expect(detail?.openAssignment?.id).toBe(assignment.id);
  });

  test('assignEquipment blocks double-assign on a posted machine', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Grue mobile' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });

    // Act + Assert
    await expect(
      repo.assignEquipment({
        equipmentId: machine.id,
        projectId: PROJECT_B,
        assignedAt: ASSIGNED_AT,
      }),
    ).rejects.toThrow(EquipmentTransitionError);
  });

  test('returnEquipment frees the machine and stamps returnedAt', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Chargeuse' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });

    // Act
    const closed = await repo.returnEquipment({
      equipmentId: machine.id,
      returnedAt: RETURN_AT,
    });
    const detail = await repo.getEquipment(machine.id);

    // Assert
    expect(closed.returnedAt).toEqual(RETURN_AT);
    expect(detail?.equipment.status).toBe('disponible');
    expect(detail?.openAssignment).toBeNull();
    expect(detail?.history).toHaveLength(1);
  });

  test('returnEquipment blocks returning a disponible machine', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Camion benne' });

    // Act + Assert
    await expect(
      repo.returnEquipment({ equipmentId: machine.id, returnedAt: RETURN_AT }),
    ).rejects.toThrow(EquipmentTransitionError);
  });

  test('a freed machine can be re-assigned to another chantier', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Pelle 2' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });
    await repo.returnEquipment({
      equipmentId: machine.id,
      returnedAt: RETURN_AT,
    });

    // Act
    const second = await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_B,
      assignedAt: RETURN_AT,
    });
    const detail = await repo.getEquipment(machine.id);

    // Assert
    expect(second.projectId).toBe(PROJECT_B);
    expect(detail?.equipment.status).toBe('assignee');
    expect(detail?.history).toHaveLength(2);
  });
});

describe('InMemoryEquipmentRepository — hors_service rules', () => {
  let repo: InMemoryEquipmentRepository;
  beforeEach(() => {
    repo = new InMemoryEquipmentRepository();
  });

  test('setEquipmentStatus marks a disponible machine hors_service', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Marteau piqueur' });

    // Act
    const updated = await repo.setEquipmentStatus(machine.id, 'hors_service');

    // Assert
    expect(updated?.status).toBe('hors_service');
  });

  test('setEquipmentStatus blocks hors_service while assignee', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Finisseur' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });

    // Act + Assert
    await expect(
      repo.setEquipmentStatus(machine.id, 'hors_service'),
    ).rejects.toThrow(EquipmentTransitionError);
  });

  test('setEquipmentStatus restores disponible from hors_service', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Vibreur' });
    await repo.setEquipmentStatus(machine.id, 'hors_service');

    // Act
    const restored = await repo.setEquipmentStatus(machine.id, 'disponible');

    // Assert
    expect(restored?.status).toBe('disponible');
  });

  test('setEquipmentStatus returns null for an unknown id', async () => {
    // Arrange + Act
    const updated = await repo.setEquipmentStatus('missing', 'hors_service');

    // Assert
    expect(updated).toBeNull();
  });
});

describe('InMemoryEquipmentRepository — projectEquipment & listAssignments', () => {
  let repo: InMemoryEquipmentRepository;
  beforeEach(() => {
    repo = new InMemoryEquipmentRepository();
  });

  test('projectEquipment returns only machines currently on the chantier', async () => {
    // Arrange
    const onA = await repo.upsertEquipment({ name: 'Engin A' });
    const returnedFromA = await repo.upsertEquipment({ name: 'Engin B' });
    await repo.upsertEquipment({ name: 'Engin idle' });
    await repo.assignEquipment({
      equipmentId: onA.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });
    await repo.assignEquipment({
      equipmentId: returnedFromA.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });
    await repo.returnEquipment({
      equipmentId: returnedFromA.id,
      returnedAt: RETURN_AT,
    });

    // Act
    const fleet = await repo.projectEquipment(PROJECT_A);

    // Assert
    expect(fleet).toHaveLength(1);
    expect(fleet[0]?.id).toBe(onA.id);
    // The open assignment rides inline (no per-machine getEquipment fan-out).
    expect(fleet[0]?.openAssignment.projectId).toBe(PROJECT_A);
    expect(fleet[0]?.openAssignment.assignedAt).toEqual(ASSIGNED_AT);
    expect(fleet[0]?.openAssignment.returnedAt).toBeUndefined();
  });

  test('projectEquipment surfaces the expected-return date inline', async () => {
    // Arrange
    const onA = await repo.upsertEquipment({ name: 'Engin avec retour' });
    await repo.assignEquipment({
      equipmentId: onA.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
      expectedReturnAt: RETURN_AT,
    });

    // Act
    const fleet = await repo.projectEquipment(PROJECT_A);

    // Assert
    expect(fleet[0]?.openAssignment.expectedReturnAt).toEqual(RETURN_AT);
  });

  test('listAssignments filters by open and by equipmentId', async () => {
    // Arrange
    const machine = await repo.upsertEquipment({ name: 'Engin C' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_A,
      assignedAt: ASSIGNED_AT,
    });
    await repo.returnEquipment({
      equipmentId: machine.id,
      returnedAt: RETURN_AT,
    });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_B,
      assignedAt: RETURN_AT,
    });

    // Act
    const open = await repo.listAssignments({ open: true });
    const all = await repo.listAssignments({ equipmentId: machine.id });

    // Assert
    expect(open).toHaveLength(1);
    expect(open[0]?.projectId).toBe(PROJECT_B);
    expect(all).toHaveLength(2);
  });
});
