import { beforeEach, describe, expect, test } from 'vitest';
import { WorkOrderTransitionError } from './equipment.maintenance.domain';
import { InMemoryEquipmentRepository } from './equipment.repository';

const TODAY = new Date('2026-07-08T00:00:00Z');

async function seedMachine(repo: InMemoryEquipmentRepository): Promise<string> {
  const machine = await repo.upsertEquipment({ name: 'Pelle CAT 320' });
  return machine.id;
}

describe('InMemoryEquipmentRepository — documents', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = await seedMachine(repo);
  });

  test('addDocument stores a compliance document and lists it', async () => {
    await repo.addDocument({
      equipmentId: machineId,
      type: 'assurance',
      reference: 'POL-2026-01',
      expiryDate: new Date('2026-07-20'),
    });

    const docs = await repo.listDocuments(machineId);

    expect(docs).toHaveLength(1);
    expect(docs[0]!.type).toBe('assurance');
    expect(docs[0]!.reference).toBe('POL-2026-01');
  });

  test('expiringDocuments surfaces only docs inside the window, with status + machine name, expiry-first', async () => {
    // expires in 12 days → expire_bientot
    await repo.addDocument({
      equipmentId: machineId,
      type: 'assurance',
      expiryDate: new Date('2026-07-20'),
    });
    // expired a week ago → expire
    await repo.addDocument({
      equipmentId: machineId,
      type: 'controle_technique',
      expiryDate: new Date('2026-07-01'),
    });
    // no expiry → never surfaces
    await repo.addDocument({ equipmentId: machineId, type: 'carte_grise' });
    // far away → outside the 30-day window
    await repo.addDocument({
      equipmentId: machineId,
      type: 'visite_technique',
      expiryDate: new Date('2026-12-31'),
    });

    const alerts = await repo.expiringDocuments(30, TODAY);

    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.type).toBe('controle_technique');
    expect(alerts[0]!.status).toBe('expire');
    expect(alerts[0]!.equipmentName).toBe('Pelle CAT 320');
    expect(alerts[1]!.status).toBe('expire_bientot');
  });
});

describe('InMemoryEquipmentRepository — meters', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = await seedMachine(repo);
  });

  test('currentMeter returns null before any reading', async () => {
    expect(await repo.currentMeter(machineId)).toBeNull();
  });

  test('addMeterReading + currentMeter returns the latest value and unit', async () => {
    await repo.addMeterReading({
      equipmentId: machineId,
      readingDate: new Date('2026-05-01'),
      value: 1200,
      unit: 'heures',
    });
    await repo.addMeterReading({
      equipmentId: machineId,
      readingDate: new Date('2026-07-01'),
      value: 1500,
      unit: 'heures',
    });

    expect(await repo.currentMeter(machineId)).toEqual({
      value: 1500,
      unit: 'heures',
    });
    const log = await repo.listMeterReadings(machineId);
    expect(log).toHaveLength(2);
    expect(log[0]!.readingDate).toEqual(new Date('2026-07-01'));
  });
});

describe('InMemoryEquipmentRepository — work orders', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = await seedMachine(repo);
  });

  test('createWorkOrder opens a work order in "ouvert"', async () => {
    const wo = await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'correctif',
      title: 'Fuite hydraulique',
      openedAt: new Date('2026-07-05'),
    });

    expect(wo.status).toBe('ouvert');
    expect(wo.type).toBe('correctif');
  });

  test('setWorkOrderStatus closes a work order with a cost and drives the cost rollup', async () => {
    const wo = await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'correctif',
      title: 'Fuite',
      openedAt: new Date('2026-07-05'),
    });

    await repo.setWorkOrderStatus(wo.id, { status: 'en_cours' });
    await repo.setWorkOrderStatus(wo.id, {
      status: 'clos',
      costMad: 3500,
      completedAt: new Date('2026-07-06'),
    });

    const list = await repo.listWorkOrders({ equipmentId: machineId });
    expect(list[0]!.status).toBe('clos');
    expect(list[0]!.costMad).toBe(3500);
    expect(await repo.equipmentCost(machineId)).toBe(3500);
  });

  test('setWorkOrderStatus rejects an illegal transition (reopening a closed order)', async () => {
    const wo = await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'preventif',
      title: 'Vidange',
      openedAt: new Date('2026-07-05'),
    });
    await repo.setWorkOrderStatus(wo.id, { status: 'clos' });

    await expect(
      repo.setWorkOrderStatus(wo.id, { status: 'en_cours' }),
    ).rejects.toThrow(WorkOrderTransitionError);
  });

  test('listWorkOrders filters by status', async () => {
    const a = await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'correctif',
      title: 'A',
      openedAt: new Date('2026-07-05'),
    });
    await repo.createWorkOrder({
      equipmentId: machineId,
      type: 'preventif',
      title: 'B',
      openedAt: new Date('2026-07-06'),
    });
    await repo.setWorkOrderStatus(a.id, { status: 'clos' });

    const open = await repo.listWorkOrders({
      equipmentId: machineId,
      status: 'ouvert',
    });

    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe('B');
  });
});
