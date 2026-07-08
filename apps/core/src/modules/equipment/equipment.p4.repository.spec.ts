import { describe, expect, test } from 'vitest';
import { InMemoryEquipmentRepository } from './equipment.repository';

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const OPERATOR_ID = '11111111-1111-1111-1111-111111111111';

describe('InMemoryEquipmentRepository — operator on assignment', () => {
  test('assignEquipment stores the operator and getEquipment surfaces it', async () => {
    const repo = new InMemoryEquipmentRepository();
    const machine = await repo.upsertEquipment({ name: 'Pelle CAT 320' });

    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_ID,
      assignedAt: new Date('2026-07-08'),
      operatorId: OPERATOR_ID,
    });

    const detail = await repo.getEquipment(machine.id);
    expect(detail!.openAssignment!.operatorId).toBe(OPERATOR_ID);
  });

  test('the operator is optional — an assignment without a driver is fine', async () => {
    const repo = new InMemoryEquipmentRepository();
    const machine = await repo.upsertEquipment({ name: 'Camion Volvo' });

    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_ID,
      assignedAt: new Date('2026-07-08'),
    });

    const detail = await repo.getEquipment(machine.id);
    expect(detail!.openAssignment!.operatorId).toBeUndefined();
  });

  test('projectEquipment carries the operator inline', async () => {
    const repo = new InMemoryEquipmentRepository();
    const machine = await repo.upsertEquipment({ name: 'Nacelle' });
    await repo.assignEquipment({
      equipmentId: machine.id,
      projectId: PROJECT_ID,
      assignedAt: new Date('2026-07-08'),
      operatorId: OPERATOR_ID,
    });

    const fleet = await repo.projectEquipment(PROJECT_ID);
    expect(fleet).toHaveLength(1);
    expect(fleet[0]!.openAssignment.operatorId).toBe(OPERATOR_ID);
  });
});
