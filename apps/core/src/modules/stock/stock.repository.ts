import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
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
    // O(n) by design: every (depot, material) balance is folded from the full
    // append-only movement log rather than a materialized running total, so a
    // late-arriving back-dated event self-corrects without a rebuild. For this
    // phase the log stays small (single company, a handful of depots), so the
    // full scan is acceptable. If the event count grows large, replace this with
    // an in-database aggregate (GROUP BY depot/material with signed quantity) or
    // a periodically-compacted balance snapshot — the fold lives in stock.domain
    // (computeBalances), so the SQL can change without touching the contract.
    const rows = await this.db.select().from(stockMovements);
    return computeBalances(rows.map(toMovementRecord).map(toMovementEntry));
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
