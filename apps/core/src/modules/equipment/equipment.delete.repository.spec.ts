import { beforeEach, describe, expect, test } from 'vitest';
import { EquipmentTransitionError } from './equipment.domain';
import { InMemoryEquipmentRepository } from './equipment.repository';

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const TODAY = new Date('2026-07-08T00:00:00Z');

describe('InMemoryEquipmentRepository — deleteEquipment', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = (await repo.upsertEquipment({ name: 'Pelle CAT 320' })).id;
  });

  test('cascade-deletes the machine and ALL its records', async () => {
    await repo.addDocument({ equipmentId: machineId, type: 'assurance' });
    await repo.addMeterReading({
      equipmentId: machineId,
      readingDate: TODAY,
      value: 1200,
      unit: 'heures',
    });
    await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'correctif',
      title: 'Fuite',
      openedAt: TODAY,
    });
    await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
    });
    await repo.createInspection({
      equipmentId: machineId,
      type: 'securite',
      inspectionDate: TODAY,
    });

    const deleted = await repo.deleteEquipment(machineId);

    expect(deleted).toBe(true);
    expect(await repo.getEquipment(machineId)).toBeNull();
    expect(await repo.listDocuments(machineId)).toHaveLength(0);
    expect(await repo.listMeterReadings(machineId)).toHaveLength(0);
    expect(await repo.listWorkOrders({ equipmentId: machineId })).toHaveLength(0);
    expect(await repo.listMaintenancePlans(machineId, TODAY)).toHaveLength(0);
    expect(await repo.listInspections(machineId)).toHaveLength(0);
  });

  test('returns false for an unknown machine', async () => {
    expect(
      await repo.deleteEquipment('00000000-0000-0000-0000-000000000000'),
    ).toBe(false);
  });

  test('refuses to delete a machine currently assigned to a chantier', async () => {
    await repo.assignEquipment({
      equipmentId: machineId,
      projectId: PROJECT_ID,
      assignedAt: TODAY,
    });

    await expect(repo.deleteEquipment(machineId)).rejects.toThrow(
      EquipmentTransitionError,
    );
    // Still there after the refused delete.
    expect(await repo.getEquipment(machineId)).not.toBeNull();
  });
});
