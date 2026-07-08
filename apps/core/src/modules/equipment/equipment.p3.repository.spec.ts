import { beforeEach, describe, expect, test } from 'vitest';
import { InMemoryEquipmentRepository } from './equipment.repository';

const TODAY = new Date('2026-07-08T00:00:00Z');

describe('InMemoryEquipmentRepository — inspections', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = (await repo.upsertEquipment({ name: 'Pelle CAT 320' })).id;
  });

  test('createInspection seeds the template checklist and starts conforme', async () => {
    const insp = await repo.createInspection({
      equipmentId: machineId,
      type: 'securite',
      inspectionDate: TODAY,
      inspectedBy: 'Youssef',
    });

    expect(insp.type).toBe('securite');
    expect(insp.result).toBe('conforme');

    const list = await repo.listInspections(machineId);
    expect(list).toHaveLength(1);
    expect(list[0]!.items.length).toBeGreaterThan(0);
    expect(list[0]!.summary.total).toBe(list[0]!.items.length);
    expect(list[0]!.items.every((i) => i.status === 'ok')).toBe(true);
  });

  test('marking an item défaut flips the inspection result to non_conforme', async () => {
    await repo.createInspection({
      equipmentId: machineId,
      type: 'periodique',
      inspectionDate: TODAY,
    });
    const before = await repo.listInspections(machineId);
    const firstItem = before[0]!.items[0]!;

    await repo.setInspectionItemStatus(firstItem.id, 'defaut', 'Fuite constatée');

    const after = await repo.listInspections(machineId);
    expect(after[0]!.result).toBe('non_conforme');
    expect(after[0]!.summary.defaut).toBe(1);
    const item = after[0]!.items.find((i) => i.id === firstItem.id)!;
    expect(item.status).toBe('defaut');
    expect(item.notes).toBe('Fuite constatée');
  });

  test('deleting an inspection removes it and its items', async () => {
    const insp = await repo.createInspection({
      equipmentId: machineId,
      type: 'securite',
      inspectionDate: TODAY,
    });

    expect(await repo.deleteInspection(insp.id)).toBe(true);
    expect(await repo.listInspections(machineId)).toHaveLength(0);
  });
});

describe('InMemoryEquipmentRepository — depreciation', () => {
  let repo: InMemoryEquipmentRepository;
  let machineId: string;
  beforeEach(async () => {
    repo = new InMemoryEquipmentRepository();
    machineId = (
      await repo.upsertEquipment({
        name: 'Camion Volvo',
        acquisitionDate: new Date('2020-01-01'),
        acquisitionCostMad: 1_000_000,
        depreciationMonths: 120,
        salvageValueMad: 100_000,
      })
    ).id;
  });

  test('equipmentDepreciation computes the book value as of a date', async () => {
    const d = await repo.equipmentDepreciation(
      machineId,
      new Date('2025-01-01'),
    );
    expect(d.applicable).toBe(true);
    expect(d.bookValueMad).toBe(550_000);
  });

  test('upsert stores the depreciation params on the equipment record', async () => {
    const page = await repo.listEquipment({}, { limit: 10, offset: 0 });
    const machine = page.items.find((e) => e.name === 'Camion Volvo')!;
    expect(machine.acquisitionCostMad).toBe(1_000_000);
    expect(machine.depreciationMonths).toBe(120);
    expect(machine.salvageValueMad).toBe(100_000);
  });
});
