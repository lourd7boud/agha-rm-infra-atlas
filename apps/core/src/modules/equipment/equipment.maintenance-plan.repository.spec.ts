import { beforeEach, describe, expect, test } from 'vitest';
import { InMemoryEquipmentRepository } from './equipment.repository';

const TODAY = new Date('2026-07-08T00:00:00Z');

async function seedMachine(repo: InMemoryEquipmentRepository): Promise<string> {
  const machine = await repo.upsertEquipment({ name: 'Pelle CAT 320' });
  return machine.id;
}

async function seedMeter(
  repo: InMemoryEquipmentRepository,
  equipmentId: string,
  value: number,
): Promise<void> {
  await repo.addMeterReading({
    equipmentId,
    readingDate: new Date('2026-07-01'),
    value,
    unit: 'heures',
  });
}

describe('InMemoryEquipmentRepository — maintenance plans', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = await seedMachine(repo);
  });

  test('createMaintenancePlan + listMaintenancePlans computes due status from the meter', async () => {
    await seedMeter(repo, machineId, 1240);
    await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      meterUnit: 'heures',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });

    const plans = await repo.listMaintenancePlans(machineId, TODAY);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.name).toBe('Vidange');
    expect(plans[0]!.due.nextDueMeter).toBe(1250);
    expect(plans[0]!.due.status).toBe('bientot'); // remaining 10 ≤ 25
  });

  test('duePlans surfaces overdue/soon plans fleet-wide with the machine name', async () => {
    await seedMeter(repo, machineId, 1300);
    await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });
    // a not-due plan (huge interval)
    await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Révision générale',
      triggerType: 'meter',
      intervalMeter: 5000,
      lastServiceMeter: 1000,
    });

    const due = await repo.duePlans(TODAY);

    expect(due).toHaveLength(1);
    expect(due[0]!.name).toBe('Vidange');
    expect(due[0]!.equipmentName).toBe('Pelle CAT 320');
    expect(due[0]!.due.status).toBe('en_retard');
  });

  test('generateDueWorkOrder creates one preventive WO for a due plan, idempotently', async () => {
    await seedMeter(repo, machineId, 1300);
    const plan = await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });

    const wo = await repo.generateDueWorkOrder(plan.id, TODAY);
    expect(wo).not.toBeNull();
    expect(wo!.type).toBe('preventif');
    expect(wo!.status).toBe('ouvert');
    expect(wo!.planId).toBe(plan.id);

    // second call → an open WO already exists for the plan → null
    expect(await repo.generateDueWorkOrder(plan.id, TODAY)).toBeNull();
    const wos = await repo.listWorkOrders({ equipmentId: machineId });
    expect(wos.filter((w) => w.type === 'preventif')).toHaveLength(1);
  });

  test('generateDueWorkOrder returns null when the plan is not due', async () => {
    await seedMeter(repo, machineId, 1100);
    const plan = await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });

    expect(await repo.generateDueWorkOrder(plan.id, TODAY)).toBeNull();
  });

  test('closing a plan-generated work order advances the plan baseline', async () => {
    await seedMeter(repo, machineId, 1300);
    const plan = await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });
    const wo = await repo.generateDueWorkOrder(plan.id, TODAY);

    await repo.setWorkOrderStatus(wo!.id, {
      status: 'clos',
      meterAtService: 1305,
      completedAt: new Date('2026-07-08'),
    });

    const plans = await repo.listMaintenancePlans(machineId, TODAY);
    expect(plans[0]!.lastServiceMeter).toBe(1305);
    expect(plans[0]!.due.nextDueMeter).toBe(1555); // 1305 + 250
    expect(plans[0]!.due.status).toBe('a_jour'); // current 1300 < 1555
  });

  test('setMaintenancePlanActive(false) removes it from duePlans', async () => {
    await seedMeter(repo, machineId, 1300);
    const plan = await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });

    await repo.setMaintenancePlanActive(plan.id, false);

    expect(await repo.duePlans(TODAY)).toHaveLength(0);
  });

  test('deleting a plan detaches (nulls plan_id on) its generated work orders', async () => {
    await seedMeter(repo, machineId, 1300);
    const plan = await repo.createMaintenancePlan({
      equipmentId: machineId,
      name: 'Vidange',
      triggerType: 'meter',
      intervalMeter: 250,
      lastServiceMeter: 1000,
    });
    const wo = await repo.generateDueWorkOrder(plan.id, TODAY);
    expect(wo!.planId).toBe(plan.id);

    const deleted = await repo.deleteMaintenancePlan(plan.id);

    expect(deleted).toBe(true);
    expect(await repo.listMaintenancePlans(machineId, TODAY)).toHaveLength(0);
    // The work order is kept, just detached from the deleted plan.
    const wos = await repo.listWorkOrders({ equipmentId: machineId });
    expect(wos).toHaveLength(1);
    expect(wos[0]!.planId).toBeUndefined();
  });
});
