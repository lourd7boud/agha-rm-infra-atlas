import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { Db } from '../../db/client';
import { depots, materials, stockMovements } from '../../db/schema';
import {
  computeBalances,
  computeProjectConsumption,
  type DepotBalance,
  type MaterialRef,
  type MovementKind,
  type ProjectMaterialConsumption,
  type StockMovementEntry,
} from './stock.domain';

/** Per-project materials cost: valued consumption summed for one chantier. */
export interface MaterialsCostByProject {
  projectId: string;
  costMad: number;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface UpsertMaterialInput {
  code: string;
  designation: string;
  unit: string;
  category?: string;
  unitCostMad?: number;
}

export interface UpsertDepotInput {
  name: string;
  location?: string;
}

export interface RecordMovementInput {
  kind: MovementKind;
  materialId: string;
  quantity: number;
  unitCostMad?: number;
  fromDepotId?: string;
  toDepotId?: string;
  projectId?: string;
  reference?: string;
  notes?: string;
  occurredAt?: Date;
}

export interface MovementFilter {
  depotId?: string;
  materialId?: string;
  projectId?: string;
  limit?: number;
}

// ── Records ──────────────────────────────────────────────────────────────────
// Numerics surfaced as numbers (stored as strings in Postgres, like the intel repo).

export interface MaterialRecord {
  id: string;
  code: string;
  designation: string;
  unit: string;
  category?: string;
  unitCostMad?: number;
  createdAt: Date;
}

export interface DepotRecord {
  id: string;
  name: string;
  location?: string;
  createdAt: Date;
}

export interface StockMovementRecord {
  id: string;
  kind: MovementKind;
  materialId: string;
  quantity: number;
  unitCostMad?: number;
  fromDepotId?: string;
  toDepotId?: string;
  projectId?: string;
  reference?: string;
  notes?: string;
  occurredAt: Date;
  createdAt: Date;
}

export const STOCK_REPOSITORY = Symbol('STOCK_REPOSITORY');

export interface StockRepository {
  /** Inserts a material, or back-fills it when (companyId, code) exists. Idempotent. */
  upsertMaterial(input: UpsertMaterialInput): Promise<'inserted' | 'updated'>;
  listMaterials(): Promise<MaterialRecord[]>;
  /** Inserts a depot, or back-fills it when (companyId, name) exists. Idempotent. */
  upsertDepot(input: UpsertDepotInput): Promise<'inserted' | 'updated'>;
  listDepots(): Promise<DepotRecord[]>;
  /** Append-only: records one movement event and returns its id. */
  recordMovement(input: RecordMovementInput): Promise<{ id: string }>;
  listMovements(filter: MovementFilter): Promise<StockMovementRecord[]>;
  /** Signed quantity per (depot, material), folded from the movement log. */
  balances(): Promise<DepotBalance[]>;
  /** Per-material consumption rollup for one chantier, valued + with history. */
  projectConsumption(projectId: string): Promise<ProjectMaterialConsumption[]>;
  /**
   * Valued materials consumption summed per chantier, for every project at once
   * — the materials component of the portfolio cost rollup. One grouped query
   * (no per-project N+1): sums quantity × (movement cost ?? material cost ?? 0)
   * over kind 'consumption' rows that carry a projectId. Projects with no site
   * consumption simply do not appear; the cost domain defaults them to 0.
   */
  materialsCostByProject(): Promise<MaterialsCostByProject[]>;
}

const DEFAULT_MOVEMENT_LIMIT = 200;

/** A movement record reshaped into the domain's folding input. */
function toMovementEntry(record: StockMovementRecord): StockMovementEntry {
  return {
    kind: record.kind,
    materialId: record.materialId,
    quantity: record.quantity,
    unitCostMad: record.unitCostMad,
    fromDepotId: record.fromDepotId,
    toDepotId: record.toDepotId,
    projectId: record.projectId,
    reference: record.reference,
    occurredAt: record.occurredAt,
  };
}

/** A material record reshaped into the domain's pricing reference. */
function toMaterialRef(record: MaterialRecord): MaterialRef {
  return {
    id: record.id,
    designation: record.designation,
    unit: record.unit,
    unitCostMad: record.unitCostMad,
  };
}

export class InMemoryStockRepository implements StockRepository {
  private materials: readonly MaterialRecord[] = [];
  private depots: readonly DepotRecord[] = [];
  private movements: readonly StockMovementRecord[] = [];

  async upsertMaterial(
    input: UpsertMaterialInput,
  ): Promise<'inserted' | 'updated'> {
    const index = this.materials.findIndex((m) => m.code === input.code);
    if (index === -1) {
      this.materials = [
        ...this.materials,
        { ...input, id: randomUUID(), createdAt: new Date() },
      ];
      return 'inserted';
    }
    const existing = this.materials[index]!;
    // Back-fill only: incoming non-null enriches, incoming null keeps existing.
    const merged: MaterialRecord = {
      ...existing,
      designation: input.designation || existing.designation,
      unit: input.unit || existing.unit,
      category: input.category ?? existing.category,
      unitCostMad: input.unitCostMad ?? existing.unitCostMad,
    };
    this.materials = [
      ...this.materials.slice(0, index),
      merged,
      ...this.materials.slice(index + 1),
    ];
    return 'updated';
  }

  async listMaterials(): Promise<MaterialRecord[]> {
    return [...this.materials];
  }

  async upsertDepot(input: UpsertDepotInput): Promise<'inserted' | 'updated'> {
    const index = this.depots.findIndex((d) => d.name === input.name);
    if (index === -1) {
      this.depots = [
        ...this.depots,
        { ...input, id: randomUUID(), createdAt: new Date() },
      ];
      return 'inserted';
    }
    const existing = this.depots[index]!;
    const merged: DepotRecord = {
      ...existing,
      location: input.location ?? existing.location,
    };
    this.depots = [
      ...this.depots.slice(0, index),
      merged,
      ...this.depots.slice(index + 1),
    ];
    return 'updated';
  }

  async listDepots(): Promise<DepotRecord[]> {
    return [...this.depots];
  }

  async recordMovement(input: RecordMovementInput): Promise<{ id: string }> {
    const record: StockMovementRecord = {
      ...input,
      id: randomUUID(),
      occurredAt: input.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    this.movements = [...this.movements, record];
    return { id: record.id };
  }

  async listMovements(filter: MovementFilter): Promise<StockMovementRecord[]> {
    const limit = filter.limit ?? DEFAULT_MOVEMENT_LIMIT;
    return [...this.movements]
      .filter((m) => {
        if (filter.materialId && m.materialId !== filter.materialId) return false;
        if (filter.projectId && m.projectId !== filter.projectId) return false;
        if (
          filter.depotId &&
          m.fromDepotId !== filter.depotId &&
          m.toDepotId !== filter.depotId
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }

  async balances(): Promise<DepotBalance[]> {
    return computeBalances(this.movements.map(toMovementEntry));
  }

  async projectConsumption(
    projectId: string,
  ): Promise<ProjectMaterialConsumption[]> {
    const scoped = this.movements.filter((m) => m.projectId === projectId);
    return computeProjectConsumption(
      scoped.map(toMovementEntry),
      this.materials.map(toMaterialRef),
    );
  }

  async materialsCostByProject(): Promise<MaterialsCostByProject[]> {
    // Mirror the Drizzle GROUP BY: same valued-consumption fold the per-project
    // rollup uses (movement cost ?? material cost ?? 0), summed across projects.
    const costById = new Map<string, MaterialRecord>(
      this.materials.map((material) => [material.id, material]),
    );
    const totals = new Map<string, number>();
    for (const movement of this.movements) {
      if (movement.kind !== 'consumption' || !movement.projectId) continue;
      const unitCost =
        movement.unitCostMad ??
        costById.get(movement.materialId)?.unitCostMad ??
        0;
      totals.set(
        movement.projectId,
        (totals.get(movement.projectId) ?? 0) + movement.quantity * unitCost,
      );
    }
    return [...totals.entries()].map(([projectId, costMad]) => ({
      projectId,
      costMad,
    }));
  }
}

export class DrizzleStockRepository implements StockRepository {
  constructor(private readonly db: Db) {}

  async upsertMaterial(
    input: UpsertMaterialInput,
  ): Promise<'inserted' | 'updated'> {
    // One atomic INSERT … ON CONFLICT keyed on (company_id, code). The SET clause
    // is back-fill only — a non-empty incoming value enriches the row, an empty
    // or null incoming value never erases what was learned before. This mirrors
    // InMemoryStockRepository.upsertMaterial (`input.designation || existing`):
    // designation/unit fall back to the stored value when the incoming string is
    // empty (nullif → coalesce), category/cost fall back when incoming is null.
    // (xmax = 0) is the Postgres idiom for "this RETURNING row was freshly
    // inserted" — xmax is 0 on a plain INSERT and non-zero after a DO UPDATE.
    const [row] = await this.db
      .insert(materials)
      .values({
        code: input.code,
        designation: input.designation,
        unit: input.unit,
        category: input.category,
        unitCostMad: input.unitCostMad?.toString(),
      })
      .onConflictDoUpdate({
        target: [materials.companyId, materials.code],
        set: {
          designation: sql`coalesce(nullif(excluded.designation, ''), ${materials.designation})`,
          unit: sql`coalesce(nullif(excluded.unit, ''), ${materials.unit})`,
          category: sql`coalesce(excluded.category, ${materials.category})`,
          unitCostMad: sql`coalesce(excluded.unit_cost_mad, ${materials.unitCostMad})`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async listMaterials(): Promise<MaterialRecord[]> {
    const rows = await this.db
      .select()
      .from(materials)
      .orderBy(desc(materials.createdAt));
    return rows.map(toMaterialRecord);
  }

  async upsertDepot(input: UpsertDepotInput): Promise<'inserted' | 'updated'> {
    const [row] = await this.db
      .insert(depots)
      .values({ name: input.name, location: input.location })
      .onConflictDoUpdate({
        target: [depots.companyId, depots.name],
        set: {
          location: sql`coalesce(excluded.location, ${depots.location})`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async listDepots(): Promise<DepotRecord[]> {
    const rows = await this.db
      .select()
      .from(depots)
      .orderBy(desc(depots.createdAt));
    return rows.map(toDepotRecord);
  }

  async recordMovement(input: RecordMovementInput): Promise<{ id: string }> {
    // Insert-only: the stock_movement table is an append-only event log.
    const [row] = await this.db
      .insert(stockMovements)
      .values({
        kind: input.kind,
        materialId: input.materialId,
        quantity: input.quantity.toString(),
        unitCostMad: input.unitCostMad?.toString(),
        fromDepotId: input.fromDepotId,
        toDepotId: input.toDepotId,
        projectId: input.projectId,
        reference: input.reference,
        notes: input.notes,
        occurredAt: input.occurredAt,
      })
      .returning({ id: stockMovements.id });
    if (!row) throw new Error('Stock movement insert returned no row');
    return { id: row.id };
  }

  async listMovements(filter: MovementFilter): Promise<StockMovementRecord[]> {
    const limit = filter.limit ?? DEFAULT_MOVEMENT_LIMIT;
    const conditions = [
      filter.materialId
        ? eq(stockMovements.materialId, filter.materialId)
        : undefined,
      filter.projectId
        ? eq(stockMovements.projectId, filter.projectId)
        : undefined,
      filter.depotId
        ? sql`(${stockMovements.fromDepotId} = ${filter.depotId} or ${stockMovements.toDepotId} = ${filter.depotId})`
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const rows = await this.db
      .select()
      .from(stockMovements)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(stockMovements.occurredAt))
      .limit(limit);
    return rows.map(toMovementRecord);
  }

  async balances(): Promise<DepotBalance[]> {
    // In-DB aggregate: SUM the signed movement quantities per (depot, material)
    // in Postgres instead of shipping the whole append-only log to JS and folding
    // it there. Only the O(depot×material) aggregate rows cross the wire, not
    // O(movements), so this scales as the event log grows. Signing mirrors
    // stock.domain computeBalances (SCHEMA_SPEC): +quantity at to_depot for
    // initial/purchase/adjustment/transfer, -quantity at from_depot for
    // consumption/transfer; a transfer contributes to BOTH sides (the two arms of
    // the UNION). The InMemory repo keeps the computeBalances fold, and its spec
    // pins the shared contract, so the two paths can't drift.
    const inflow = this.db
      .select({
        depotId: sql<string>`${stockMovements.toDepotId}`.as('depot_id'),
        materialId: stockMovements.materialId,
        signed: sql<string>`${stockMovements.quantity}`.as('signed'),
      })
      .from(stockMovements)
      .where(
        and(
          isNotNull(stockMovements.toDepotId),
          inArray(stockMovements.kind, [
            'initial',
            'purchase',
            'adjustment',
            'transfer',
          ]),
        ),
      );
    const outflow = this.db
      .select({
        depotId: sql<string>`${stockMovements.fromDepotId}`.as('depot_id'),
        materialId: stockMovements.materialId,
        signed: sql<string>`-${stockMovements.quantity}`.as('signed'),
      })
      .from(stockMovements)
      .where(
        and(
          isNotNull(stockMovements.fromDepotId),
          inArray(stockMovements.kind, ['consumption', 'transfer']),
        ),
      );
    const moves = unionAll(inflow, outflow).as('moves');
    const rows = await this.db
      .select({
        depotId: moves.depotId,
        materialId: moves.materialId,
        quantity: sql<string>`sum(${moves.signed})`,
      })
      .from(moves)
      .groupBy(moves.depotId, moves.materialId);
    return rows.map((row) => ({
      depotId: row.depotId,
      materialId: row.materialId,
      quantity: Number(row.quantity),
    }));
  }

  async projectConsumption(
    projectId: string,
  ): Promise<ProjectMaterialConsumption[]> {
    const [movementRows, materialRows] = await Promise.all([
      this.db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.projectId, projectId)),
      this.db.select().from(materials),
    ]);
    return computeProjectConsumption(
      movementRows.map(toMovementRecord).map(toMovementEntry),
      materialRows.map(toMaterialRecord).map(toMaterialRef),
    );
  }

  async materialsCostByProject(): Promise<MaterialsCostByProject[]> {
    // One GROUP BY project_id query: SUM(quantity × coalesce(movement cost,
    // material standard cost, 0)) over site-consumption rows only. The join to
    // materials supplies the standard-cost fallback when a movement has no
    // explicit unit cost — same valuation as computeProjectConsumption, summed
    // in SQL so the whole portfolio costs one round trip, not one per project.
    // stock_movement_project_id_idx backs the project_id filter/grouping.
    const rows = await this.db
      .select({
        projectId: stockMovements.projectId,
        costMad: sql<string>`coalesce(sum(${stockMovements.quantity} * coalesce(${stockMovements.unitCostMad}, ${materials.unitCostMad}, 0)), 0)`,
      })
      .from(stockMovements)
      .innerJoin(materials, eq(materials.id, stockMovements.materialId))
      .where(
        and(
          eq(stockMovements.kind, 'consumption'),
          isNotNull(stockMovements.projectId),
        ),
      )
      .groupBy(stockMovements.projectId);
    return rows.flatMap((row) =>
      row.projectId
        ? [{ projectId: row.projectId, costMad: Number(row.costMad) }]
        : [],
    );
  }
}

type MaterialRow = typeof materials.$inferSelect;
type DepotRow = typeof depots.$inferSelect;
type MovementRow = typeof stockMovements.$inferSelect;

function toMaterialRecord(row: MaterialRow): MaterialRecord {
  return {
    id: row.id,
    code: row.code,
    designation: row.designation,
    unit: row.unit,
    category: row.category ?? undefined,
    unitCostMad: row.unitCostMad ? Number(row.unitCostMad) : undefined,
    createdAt: row.createdAt,
  };
}

function toDepotRecord(row: DepotRow): DepotRecord {
  return {
    id: row.id,
    name: row.name,
    location: row.location ?? undefined,
    createdAt: row.createdAt,
  };
}

function toMovementRecord(row: MovementRow): StockMovementRecord {
  return {
    id: row.id,
    kind: row.kind as MovementKind,
    materialId: row.materialId,
    quantity: Number(row.quantity),
    unitCostMad: row.unitCostMad ? Number(row.unitCostMad) : undefined,
    fromDepotId: row.fromDepotId ?? undefined,
    toDepotId: row.toDepotId ?? undefined,
    projectId: row.projectId ?? undefined,
    reference: row.reference ?? undefined,
    notes: row.notes ?? undefined,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}
