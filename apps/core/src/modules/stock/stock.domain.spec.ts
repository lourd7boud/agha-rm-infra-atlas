import { describe, expect, it } from 'vitest';
import {
  computeBalances,
  computeProjectConsumption,
  type MaterialRef,
  type StockMovementEntry,
} from './stock.domain';

const ciment: MaterialRef = {
  id: 'mat-ciment',
  designation: 'Ciment CPJ 45',
  unit: 'sac',
  unitCostMad: 72,
};

describe('computeBalances', () => {
  it('adds initial and purchase quantities at the destination depot', () => {
    // Arrange
    const movements: StockMovementEntry[] = [
      {
        kind: 'initial',
        materialId: 'mat-ciment',
        quantity: 100,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-01'),
      },
      {
        kind: 'purchase',
        materialId: 'mat-ciment',
        quantity: 50,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-05'),
      },
    ];

    // Act
    const balances = computeBalances(movements);

    // Assert
    expect(balances).toEqual([
      { depotId: 'depot-central', materialId: 'mat-ciment', quantity: 150 },
    ]);
  });

  it('subtracts consumption from the source depot', () => {
    // Arrange
    const movements: StockMovementEntry[] = [
      {
        kind: 'purchase',
        materialId: 'mat-ciment',
        quantity: 100,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-01'),
      },
      {
        kind: 'consumption',
        materialId: 'mat-ciment',
        quantity: 30,
        fromDepotId: 'depot-central',
        projectId: 'proj-1',
        occurredAt: new Date('2026-01-10'),
      },
    ];

    // Act
    const balances = computeBalances(movements);

    // Assert
    expect(balances).toEqual([
      { depotId: 'depot-central', materialId: 'mat-ciment', quantity: 70 },
    ]);
  });

  it('moves quantity between depots on a transfer', () => {
    // Arrange
    const movements: StockMovementEntry[] = [
      {
        kind: 'purchase',
        materialId: 'mat-ciment',
        quantity: 100,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-01'),
      },
      {
        kind: 'transfer',
        materialId: 'mat-ciment',
        quantity: 40,
        fromDepotId: 'depot-central',
        toDepotId: 'depot-chantier',
        occurredAt: new Date('2026-01-08'),
      },
    ];

    // Act
    const balances = computeBalances(movements);

    // Assert
    expect(balances).toContainEqual({
      depotId: 'depot-central',
      materialId: 'mat-ciment',
      quantity: 60,
    });
    expect(balances).toContainEqual({
      depotId: 'depot-chantier',
      materialId: 'mat-ciment',
      quantity: 40,
    });
  });

  it('allows a negative adjustment at the destination depot', () => {
    // Arrange
    const movements: StockMovementEntry[] = [
      {
        kind: 'purchase',
        materialId: 'mat-ciment',
        quantity: 100,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-01'),
      },
      {
        kind: 'adjustment',
        materialId: 'mat-ciment',
        quantity: -5, // inventory loss
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-12'),
      },
    ];

    // Act
    const balances = computeBalances(movements);

    // Assert
    expect(balances).toEqual([
      { depotId: 'depot-central', materialId: 'mat-ciment', quantity: 95 },
    ]);
  });

  it('returns an empty list for no movements', () => {
    // Arrange / Act / Assert
    expect(computeBalances([])).toEqual([]);
  });
});

describe('computeProjectConsumption', () => {
  it('groups consumption by material with quantity and valued cost', () => {
    // Arrange — two ciment draws on the same project; the second carries an
    // explicit unit-cost override that must beat the material standard cost.
    const movements: StockMovementEntry[] = [
      {
        kind: 'consumption',
        materialId: 'mat-ciment',
        quantity: 10,
        fromDepotId: 'depot-chantier',
        projectId: 'proj-1',
        reference: 'BS-001',
        occurredAt: new Date('2026-02-01'),
      },
      {
        kind: 'consumption',
        materialId: 'mat-ciment',
        quantity: 5,
        unitCostMad: 80, // overrides the 72 standard for this draw
        fromDepotId: 'depot-chantier',
        projectId: 'proj-1',
        reference: 'BS-002',
        occurredAt: new Date('2026-02-03'),
      },
    ];

    // Act
    const consumption = computeProjectConsumption(movements, [ciment]);

    // Assert — 10 sacs @72 + 5 sacs @80 = 720 + 400 = 1120 MAD; 2 history rows.
    expect(consumption).toHaveLength(1);
    expect(consumption[0]).toMatchObject({
      materialId: 'mat-ciment',
      designation: 'Ciment CPJ 45',
      unit: 'sac',
      totalQuantity: 15,
      totalCostMad: 1120,
    });
    expect(consumption[0]?.history).toEqual([
      {
        occurredAt: new Date('2026-02-01'),
        quantity: 10,
        fromDepotId: 'depot-chantier',
        reference: 'BS-001',
      },
      {
        occurredAt: new Date('2026-02-03'),
        quantity: 5,
        fromDepotId: 'depot-chantier',
        reference: 'BS-002',
      },
    ]);
  });

  it('ignores non-consumption and project-less movements', () => {
    // Arrange — a purchase and a project-less consumption must NOT appear.
    const movements: StockMovementEntry[] = [
      {
        kind: 'purchase',
        materialId: 'mat-ciment',
        quantity: 100,
        toDepotId: 'depot-central',
        occurredAt: new Date('2026-01-01'),
      },
      {
        kind: 'consumption',
        materialId: 'mat-ciment',
        quantity: 3,
        fromDepotId: 'depot-central',
        occurredAt: new Date('2026-01-02'),
      },
    ];

    // Act
    const consumption = computeProjectConsumption(movements, [ciment]);

    // Assert
    expect(consumption).toEqual([]);
  });

  it('falls back to material id and standard cost when material is unknown', () => {
    // Arrange — material not supplied; standard cost unknown → cost 0 (no override).
    const movements: StockMovementEntry[] = [
      {
        kind: 'consumption',
        materialId: 'mat-unknown',
        quantity: 7,
        fromDepotId: 'depot-chantier',
        projectId: 'proj-1',
        occurredAt: new Date('2026-02-10'),
      },
    ];

    // Act
    const consumption = computeProjectConsumption(movements, []);

    // Assert
    expect(consumption[0]).toMatchObject({
      materialId: 'mat-unknown',
      designation: 'mat-unknown',
      unit: '',
      totalQuantity: 7,
      totalCostMad: 0,
    });
  });
});
