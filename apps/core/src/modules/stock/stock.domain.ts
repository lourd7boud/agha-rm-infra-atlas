/**
 * Stock & matériaux division — pure folding of the append-only movement log
 * into derived views. The tables hold no running total; balances and per-chantier
 * consumption are computed here so the same arithmetic backs both the in-memory
 * and Drizzle repositories (recon: one definition, two stores).
 *
 * Signing convention (per SCHEMA_SPEC):
 *   initial / purchase  → +quantity at toDepotId
 *   consumption         → -quantity at fromDepotId
 *   transfer            → -quantity at fromDepotId AND +quantity at toDepotId
 *   adjustment          → +quantity at toDepotId (quantity may be negative)
 */

export type MovementKind =
  | 'initial'
  | 'purchase'
  | 'transfer'
  | 'consumption'
  | 'adjustment';

/** One row of the stock_movement event log, numerics as numbers. */
export interface StockMovementEntry {
  kind: MovementKind;
  materialId: string;
  quantity: number;
  unitCostMad?: number;
  fromDepotId?: string;
  toDepotId?: string;
  projectId?: string;
  reference?: string;
  occurredAt: Date;
}

/** A material's unit/cost reference, used to price consumption. */
export interface MaterialRef {
  id: string;
  designation: string;
  unit: string;
  unitCostMad?: number;
}

/** Signed quantity on hand for one (depot, material) pair. */
export interface DepotBalance {
  depotId: string;
  materialId: string;
  quantity: number;
}

/** A single consumption event in a material's per-project history. */
export interface ConsumptionHistoryEntry {
  occurredAt: Date;
  quantity: number;
  fromDepotId?: string;
  reference?: string;
}

/** Per-material rollup of one project's consumption + its raw history. */
export interface ProjectMaterialConsumption {
  materialId: string;
  designation: string;
  unit: string;
  totalQuantity: number;
  totalCostMad: number;
  history: ConsumptionHistoryEntry[];
}

/** Map key for a (depot, material) balance bucket. */
function balanceKey(depotId: string, materialId: string): string {
  return `${depotId} ${materialId}`;
}

/**
 * Folds the movement log into a signed quantity per (depot, material). A
 * transfer touches two depots (out of source, into destination); every other
 * kind touches a single depot per its sign. Movements whose required depot is
 * absent contribute nothing to that side.
 */
export function computeBalances(
  movements: readonly StockMovementEntry[],
): DepotBalance[] {
  const totals = new Map<string, DepotBalance>();

  const add = (depotId: string, materialId: string, delta: number): void => {
    const key = balanceKey(depotId, materialId);
    const current = totals.get(key) ?? { depotId, materialId, quantity: 0 };
    totals.set(key, { ...current, quantity: current.quantity + delta });
  };

  for (const movement of movements) {
    switch (movement.kind) {
      case 'initial':
      case 'purchase':
      case 'adjustment':
        if (movement.toDepotId) {
          add(movement.toDepotId, movement.materialId, movement.quantity);
        }
        break;
      case 'consumption':
        if (movement.fromDepotId) {
          add(movement.fromDepotId, movement.materialId, -movement.quantity);
        }
        break;
      case 'transfer':
        if (movement.fromDepotId) {
          add(movement.fromDepotId, movement.materialId, -movement.quantity);
        }
        if (movement.toDepotId) {
          add(movement.toDepotId, movement.materialId, movement.quantity);
        }
        break;
    }
  }

  return [...totals.values()];
}

/** Per-movement unit cost: explicit override, else the material's standard, else 0. */
function unitCostFor(
  movement: StockMovementEntry,
  material?: MaterialRef,
): number {
  return movement.unitCostMad ?? material?.unitCostMad ?? 0;
}

/**
 * Groups site-consumption movements (kind 'consumption' WITH a projectId) for
 * the given project by material, returning quantity + valued cost and the raw
 * history. totalCostMad sums quantity × (movement cost ?? material cost ?? 0).
 * The material's designation/unit decorate the rollup; an unknown material falls
 * back to its id and an empty unit so the row is never silently dropped.
 */
export function computeProjectConsumption(
  movements: readonly StockMovementEntry[],
  materials: readonly MaterialRef[],
): ProjectMaterialConsumption[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const grouped = new Map<string, ProjectMaterialConsumption>();

  for (const movement of movements) {
    if (movement.kind !== 'consumption' || !movement.projectId) continue;
    const material = byId.get(movement.materialId);
    const cost = movement.quantity * unitCostFor(movement, material);
    const entry: ConsumptionHistoryEntry = {
      occurredAt: movement.occurredAt,
      quantity: movement.quantity,
      fromDepotId: movement.fromDepotId,
      reference: movement.reference,
    };
    const current = grouped.get(movement.materialId) ?? {
      materialId: movement.materialId,
      designation: material?.designation ?? movement.materialId,
      unit: material?.unit ?? '',
      totalQuantity: 0,
      totalCostMad: 0,
      history: [],
    };
    grouped.set(movement.materialId, {
      ...current,
      totalQuantity: current.totalQuantity + movement.quantity,
      totalCostMad: current.totalCostMad + cost,
      history: [...current.history, entry],
    });
  }

  return [...grouped.values()];
}
