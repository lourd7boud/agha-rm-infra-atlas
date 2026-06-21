import { describe, expect, it } from 'vitest';
import { InMemoryStockRepository } from './stock.repository';

describe('InMemoryStockRepository.upsertMaterial', () => {
  it('inserts then back-fills idempotently on the same code', async () => {
    // Arrange
    const repo = new InMemoryStockRepository();

    // Act — first write inserts; second write with the same code back-fills.
    const first = await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
    });
    const second = await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      unitCostMad: 72,
    });

    // Assert — no duplicate row; the cost the second call supplied is kept.
    expect(first).toBe('inserted');
    expect(second).toBe('updated');
    const materials = await repo.listMaterials();
    expect(materials).toHaveLength(1);
    expect(materials[0]?.unitCostMad).toBe(72);
  });
});

describe('InMemoryStockRepository.upsertDepot', () => {
  it('inserts then back-fills idempotently on the same name', async () => {
    // Arrange
    const repo = new InMemoryStockRepository();

    // Act
    const first = await repo.upsertDepot({ name: 'Dépôt Central' });
    const second = await repo.upsertDepot({
      name: 'Dépôt Central',
      location: 'Marrakech',
    });

    // Assert
    expect(first).toBe('inserted');
    expect(second).toBe('updated');
    const depots = await repo.listDepots();
    expect(depots).toHaveLength(1);
    expect(depots[0]?.location).toBe('Marrakech');
  });
});

describe('InMemoryStockRepository.recordMovement + balances', () => {
  it('records movements and folds them into per-depot balances', async () => {
    // Arrange — one material, two depots, then purchase + transfer + consumption.
    const repo = new InMemoryStockRepository();
    await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      unitCostMad: 72,
    });
    const [material] = await repo.listMaterials();
    const materialId = material!.id;
    const central = 'depot-central';
    const chantier = 'depot-chantier';

    // Act
    const movement = await repo.recordMovement({
      kind: 'purchase',
      materialId,
      quantity: 100,
      toDepotId: central,
      occurredAt: new Date('2026-03-01'),
    });
    await repo.recordMovement({
      kind: 'transfer',
      materialId,
      quantity: 40,
      fromDepotId: central,
      toDepotId: chantier,
      occurredAt: new Date('2026-03-02'),
    });
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 10,
      fromDepotId: chantier,
      projectId: 'proj-1',
      occurredAt: new Date('2026-03-03'),
    });

    // Assert — movement got an id; central=60, chantier=30 after the three events.
    expect(movement.id).toBeTruthy();
    const balances = await repo.balances();
    expect(balances).toContainEqual({
      depotId: central,
      materialId,
      quantity: 60,
    });
    expect(balances).toContainEqual({
      depotId: chantier,
      materialId,
      quantity: 30,
    });
  });

  it('filters movements by project', async () => {
    // Arrange
    const repo = new InMemoryStockRepository();
    await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
    });
    const [material] = await repo.listMaterials();
    const materialId = material!.id;
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 5,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-1',
      occurredAt: new Date('2026-03-04'),
    });
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 3,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-2',
      occurredAt: new Date('2026-03-05'),
    });

    // Act
    const scoped = await repo.listMovements({ projectId: 'proj-1' });

    // Assert
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.projectId).toBe('proj-1');
  });
});

describe('InMemoryStockRepository.projectConsumption', () => {
  it('rolls up valued per-project consumption with history', async () => {
    // Arrange
    const repo = new InMemoryStockRepository();
    await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      unitCostMad: 72,
    });
    const [material] = await repo.listMaterials();
    const materialId = material!.id;
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 10,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-1',
      reference: 'BS-001',
      occurredAt: new Date('2026-03-06'),
    });
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 5,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-1',
      reference: 'BS-002',
      occurredAt: new Date('2026-03-07'),
    });
    // A different project's draw must NOT leak into proj-1's rollup.
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 99,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-2',
      occurredAt: new Date('2026-03-08'),
    });

    // Act
    const consumption = await repo.projectConsumption('proj-1');

    // Assert — 15 sacs @72 = 1080 MAD across two history rows, proj-1 only.
    expect(consumption).toHaveLength(1);
    expect(consumption[0]).toMatchObject({
      materialId,
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      totalQuantity: 15,
      totalCostMad: 1080,
    });
    expect(consumption[0]?.history).toHaveLength(2);
  });
});

describe('InMemoryStockRepository.materialsCostByProject', () => {
  it('sums valued consumption per project across the whole portfolio', async () => {
    // Arrange — consumption on two projects; a non-consumption move is ignored.
    const repo = new InMemoryStockRepository();
    await repo.upsertMaterial({
      code: 'CIM-001',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      unitCostMad: 72,
    });
    const [material] = await repo.listMaterials();
    const materialId = material!.id;
    // proj-1: 10 + 5 sacs @72 = 1080 MAD.
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 10,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-1',
      occurredAt: new Date('2026-03-06'),
    });
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 5,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-1',
      occurredAt: new Date('2026-03-07'),
    });
    // proj-2: 3 sacs @72 = 216 MAD.
    await repo.recordMovement({
      kind: 'consumption',
      materialId,
      quantity: 3,
      fromDepotId: 'depot-chantier',
      projectId: 'proj-2',
      occurredAt: new Date('2026-03-08'),
    });
    // A purchase (not a consumption) must not contribute to any project's cost.
    await repo.recordMovement({
      kind: 'purchase',
      materialId,
      quantity: 100,
      toDepotId: 'depot-central',
      occurredAt: new Date('2026-03-01'),
    });

    // Act
    const costs = await repo.materialsCostByProject();

    // Assert — one row per project, valued by the material's standard cost.
    expect(costs).toHaveLength(2);
    expect(costs.find((c) => c.projectId === 'proj-1')?.costMad).toBe(1080);
    expect(costs.find((c) => c.projectId === 'proj-2')?.costMad).toBe(216);
  });
});
