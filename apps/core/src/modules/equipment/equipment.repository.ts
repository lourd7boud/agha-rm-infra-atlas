/**
 * Matériel & engins — repository contract + InMemory and Drizzle stores.
 * upsertEquipment back-fills on (companyId, name) like the stock/sales upserts.
 * assignEquipment / returnEquipment / setEquipmentStatus are TRANSACTIONAL: they
 * SELECT … FOR UPDATE the machine row (serialising concurrent moves on the same
 * machine), guard the move via equipment.domain, then write the assignment row
 * AND flip equipment.status in one commit (mirrors the Phase-5 sales
 * db.transaction), so the inventory status and the open-assignment log never
 * disagree under READ COMMITTED. Dates use Drizzle's date mode 'date'; money is
 * not modelled here. InMemory ↔ Drizzle keep strict behavioural parity (the
 * single-threaded InMemory store has no concurrency window, so it needs no lock).
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { equipmentAssignments, equipments } from '../../db/schema';
import {
  assertAssign,
  assertReturn,
  assertSetStatus,
  EquipmentTransitionError,
  type EquipmentStatus,
} from './equipment.domain';

// ── inputs & records ─────────────────────────────────────────────────────────

export interface UpsertEquipment {
  name: string;
  code?: string;
  category?: string;
  acquisitionDate?: Date;
  notes?: string;
}

export interface EquipmentRecord {
  id: string;
  code?: string;
  name: string;
  category?: string;
  status: EquipmentStatus;
  acquisitionDate?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignEquipmentInput {
  equipmentId: string;
  projectId: string;
  assignedAt: Date;
  expectedReturnAt?: Date;
  notes?: string;
}

export interface ReturnEquipmentInput {
  equipmentId: string;
  returnedAt: Date;
}

export interface EquipmentAssignmentRecord {
  id: string;
  equipmentId: string;
  projectId: string;
  assignedAt: Date;
  expectedReturnAt?: Date;
  returnedAt?: Date;
  notes?: string;
  createdAt: Date;
}

export interface EquipmentFilter {
  status?: EquipmentStatus;
}

export interface AssignmentFilter {
  projectId?: string;
  equipmentId?: string;
  /** When true, only OPEN assignments (returnedAt null). */
  open?: boolean;
}

/** Equipment plus its current open assignment (if any) and full history. */
export interface EquipmentDetail {
  equipment: EquipmentRecord;
  openAssignment: EquipmentAssignmentRecord | null;
  history: EquipmentAssignmentRecord[];
}

/**
 * A machine currently on a chantier, carrying its open assignment inline. Lets
 * the project view show the affecté-le / retour-prévu dates from ONE list call
 * instead of a per-machine getEquipment fan-out (N+1).
 */
export interface ProjectEquipmentRecord extends EquipmentRecord {
  openAssignment: EquipmentAssignmentRecord;
}

export const EQUIPMENT_REPOSITORY = Symbol('EQUIPMENT_REPOSITORY');

export interface EquipmentRepository {
  /** Inserts a machine, or back-fills it when (companyId, name) exists. */
  upsertEquipment(input: UpsertEquipment): Promise<EquipmentRecord>;
  listEquipment(filter: EquipmentFilter): Promise<EquipmentRecord[]>;
  /** The machine with its open assignment + assignment history, null when unknown. */
  getEquipment(id: string): Promise<EquipmentDetail | null>;
  /** TRANSACTIONAL: guards canAssign, opens an assignment, flips status to assignee. */
  assignEquipment(
    input: AssignEquipmentInput,
  ): Promise<EquipmentAssignmentRecord>;
  /** TRANSACTIONAL: guards canReturn on the open assignment, closes it, frees the machine. */
  returnEquipment(
    input: ReturnEquipmentInput,
  ): Promise<EquipmentAssignmentRecord>;
  /** hors_service / disponible toggle — guarded by assertSetStatus. */
  setEquipmentStatus(
    id: string,
    status: EquipmentStatus,
  ): Promise<EquipmentRecord | null>;
  listAssignments(
    filter: AssignmentFilter,
  ): Promise<EquipmentAssignmentRecord[]>;
  /**
   * The machines currently posted to a chantier (open assignments), each with
   * its open assignment inline — one query, no per-machine getEquipment fan-out.
   */
  projectEquipment(projectId: string): Promise<ProjectEquipmentRecord[]>;
}

// ── in-memory store (dev/test fallback) ──────────────────────────────────────

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryEquipmentRepository implements EquipmentRepository {
  private equipment: readonly EquipmentRecord[] = [];
  private assignments: readonly EquipmentAssignmentRecord[] = [];

  async upsertEquipment(input: UpsertEquipment): Promise<EquipmentRecord> {
    const index = this.equipment.findIndex((e) => e.name === input.name);
    if (index === -1) {
      const now = new Date();
      const record: EquipmentRecord = {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        category: input.category,
        status: 'disponible',
        acquisitionDate: input.acquisitionDate,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      this.equipment = [...this.equipment, record];
      return record;
    }
    // Back-fill only: incoming non-null enriches, incoming null keeps existing.
    const existing = this.equipment[index]!;
    const merged: EquipmentRecord = {
      ...existing,
      code: input.code ?? existing.code,
      category: input.category ?? existing.category,
      acquisitionDate: input.acquisitionDate ?? existing.acquisitionDate,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date(),
    };
    this.equipment = [
      ...this.equipment.slice(0, index),
      merged,
      ...this.equipment.slice(index + 1),
    ];
    return merged;
  }

  async listEquipment(filter: EquipmentFilter): Promise<EquipmentRecord[]> {
    return [...this.equipment]
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getEquipment(id: string): Promise<EquipmentDetail | null> {
    const equipment = this.equipment.find((e) => e.id === id) ?? null;
    if (!equipment) return null;
    const history = this.assignments
      .filter((a) => a.equipmentId === id)
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    const openAssignment =
      history.find((a) => a.returnedAt === undefined) ?? null;
    return { equipment, openAssignment, history };
  }

  async assignEquipment(
    input: AssignEquipmentInput,
  ): Promise<EquipmentAssignmentRecord> {
    const existing =
      this.equipment.find((e) => e.id === input.equipmentId) ?? null;
    if (!existing) {
      throw new EquipmentTransitionError('Matériel introuvable');
    }
    assertAssign(existing.status);
    const record: EquipmentAssignmentRecord = {
      id: randomUUID(),
      equipmentId: input.equipmentId,
      projectId: input.projectId,
      assignedAt: input.assignedAt,
      expectedReturnAt: input.expectedReturnAt,
      returnedAt: undefined,
      notes: input.notes,
      createdAt: new Date(),
    };
    this.assignments = [...this.assignments, record];
    this.setStatusInPlace(input.equipmentId, 'assignee');
    return record;
  }

  async returnEquipment(
    input: ReturnEquipmentInput,
  ): Promise<EquipmentAssignmentRecord> {
    const existing =
      this.equipment.find((e) => e.id === input.equipmentId) ?? null;
    if (!existing) {
      throw new EquipmentTransitionError('Matériel introuvable');
    }
    assertReturn(existing.status);
    const index = this.assignments.findIndex(
      (a) => a.equipmentId === input.equipmentId && a.returnedAt === undefined,
    );
    if (index === -1) {
      throw new EquipmentTransitionError('Aucune affectation ouverte');
    }
    const open = this.assignments[index]!;
    const closed: EquipmentAssignmentRecord = {
      ...open,
      returnedAt: input.returnedAt,
    };
    this.assignments = [
      ...this.assignments.slice(0, index),
      closed,
      ...this.assignments.slice(index + 1),
    ];
    this.setStatusInPlace(input.equipmentId, 'disponible');
    return closed;
  }

  async setEquipmentStatus(
    id: string,
    status: EquipmentStatus,
  ): Promise<EquipmentRecord | null> {
    const existing = this.equipment.find((e) => e.id === id) ?? null;
    if (!existing) return null;
    assertSetStatus(existing.status, status);
    return this.setStatusInPlace(id, status);
  }

  async listAssignments(
    filter: AssignmentFilter,
  ): Promise<EquipmentAssignmentRecord[]> {
    return [...this.assignments]
      .filter((a) => {
        if (filter.projectId && a.projectId !== filter.projectId) return false;
        if (filter.equipmentId && a.equipmentId !== filter.equipmentId) {
          return false;
        }
        if (filter.open && a.returnedAt !== undefined) return false;
        return true;
      })
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  }

  async projectEquipment(
    projectId: string,
  ): Promise<ProjectEquipmentRecord[]> {
    // The open assignment per machine on this chantier, keyed by equipmentId.
    const openByEquipment = new Map(
      this.assignments
        .filter((a) => a.projectId === projectId && a.returnedAt === undefined)
        .map((a) => [a.equipmentId, a]),
    );
    return this.equipment
      .filter((e) => openByEquipment.has(e.id))
      .map((e) => ({ ...e, openAssignment: openByEquipment.get(e.id)! }));
  }

  /** Flip a machine's status + updatedAt in place (immutable swap). */
  private setStatusInPlace(
    id: string,
    status: EquipmentStatus,
  ): EquipmentRecord {
    const index = this.equipment.findIndex((e) => e.id === id);
    const existing = this.equipment[index]!;
    const updated: EquipmentRecord = {
      ...existing,
      status,
      updatedAt: new Date(),
    };
    this.equipment = [
      ...this.equipment.slice(0, index),
      updated,
      ...this.equipment.slice(index + 1),
    ];
    return updated;
  }
}

// ── Drizzle/Postgres store ───────────────────────────────────────────────────

export class DrizzleEquipmentRepository implements EquipmentRepository {
  constructor(private readonly db: Db) {}

  async upsertEquipment(input: UpsertEquipment): Promise<EquipmentRecord> {
    // One atomic INSERT … ON CONFLICT keyed on (company_id, name). The SET clause
    // is back-fill only — a non-null incoming value enriches the row, an incoming
    // null never erases what was stored. Mirrors InMemory.upsertEquipment.
    const [row] = await this.db
      .insert(equipments)
      .values({
        code: input.code,
        name: input.name,
        category: input.category,
        acquisitionDate: input.acquisitionDate,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [equipments.companyId, equipments.name],
        set: {
          code: sql`coalesce(excluded.code, ${equipments.code})`,
          category: sql`coalesce(excluded.category, ${equipments.category})`,
          acquisitionDate: sql`coalesce(excluded.acquisition_date, ${equipments.acquisitionDate})`,
          notes: sql`coalesce(excluded.notes, ${equipments.notes})`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    if (!row) throw new Error('Equipment upsert returned no row');
    return toEquipment(row);
  }

  async listEquipment(filter: EquipmentFilter): Promise<EquipmentRecord[]> {
    const rows = await this.db
      .select()
      .from(equipments)
      .where(filter.status ? eq(equipments.status, filter.status) : undefined)
      .orderBy(desc(equipments.createdAt));
    return rows.map(toEquipment);
  }

  async getEquipment(id: string): Promise<EquipmentDetail | null> {
    const [row] = await this.db
      .select()
      .from(equipments)
      .where(eq(equipments.id, id))
      .limit(1);
    if (!row) return null;
    const historyRows = await this.db
      .select()
      .from(equipmentAssignments)
      .where(eq(equipmentAssignments.equipmentId, id))
      .orderBy(desc(equipmentAssignments.assignedAt));
    const history = historyRows.map(toAssignment);
    const openAssignment =
      history.find((a) => a.returnedAt === undefined) ?? null;
    return { equipment: toEquipment(row), openAssignment, history };
  }

  async assignEquipment(
    input: AssignEquipmentInput,
  ): Promise<EquipmentAssignmentRecord> {
    // Guard + assignment insert + status flip must commit (or roll back)
    // together: a posted machine must never lack its 'assignee' status, and a
    // failed status update must not leave a dangling open assignment. Mirrors the
    // Phase-5 sales createQuote db.transaction shape.
    return this.db.transaction(async (tx) => {
      // SELECT … FOR UPDATE: take a row lock on the machine so concurrent
      // assigns on the same equipmentId serialise. Without it, under Postgres
      // READ COMMITTED two callers can both read 'disponible' before either
      // commits, both pass assertAssign, and both open an assignment row.
      const [machine] = await tx
        .select()
        .from(equipments)
        .where(eq(equipments.id, input.equipmentId))
        .for('update')
        .limit(1);
      if (!machine) throw new EquipmentTransitionError('Matériel introuvable');
      assertAssign(machine.status as EquipmentStatus);
      const [row] = await tx
        .insert(equipmentAssignments)
        .values({
          equipmentId: input.equipmentId,
          projectId: input.projectId,
          assignedAt: input.assignedAt,
          expectedReturnAt: input.expectedReturnAt,
          notes: input.notes,
        })
        .returning();
      if (!row) throw new Error('Equipment assignment insert returned no row');
      await tx
        .update(equipments)
        .set({ status: 'assignee', updatedAt: new Date() })
        .where(eq(equipments.id, input.equipmentId));
      return toAssignment(row);
    });
  }

  async returnEquipment(
    input: ReturnEquipmentInput,
  ): Promise<EquipmentAssignmentRecord> {
    // Guard + close-the-open-assignment + free-the-machine commit together —
    // same transactional shape as assignEquipment.
    return this.db.transaction(async (tx) => {
      // SELECT … FOR UPDATE: lock the machine row so a concurrent return (or a
      // concurrent assign) on the same machine cannot interleave between this
      // read and the close-the-assignment + free-the-machine writes below.
      const [machine] = await tx
        .select()
        .from(equipments)
        .where(eq(equipments.id, input.equipmentId))
        .for('update')
        .limit(1);
      if (!machine) throw new EquipmentTransitionError('Matériel introuvable');
      assertReturn(machine.status as EquipmentStatus);
      const [open] = await tx
        .select()
        .from(equipmentAssignments)
        .where(
          and(
            eq(equipmentAssignments.equipmentId, input.equipmentId),
            isNull(equipmentAssignments.returnedAt),
          ),
        )
        .limit(1);
      if (!open) {
        throw new EquipmentTransitionError('Aucune affectation ouverte');
      }
      const [row] = await tx
        .update(equipmentAssignments)
        .set({ returnedAt: input.returnedAt })
        .where(eq(equipmentAssignments.id, open.id))
        .returning();
      if (!row) throw new Error('Equipment return update returned no row');
      await tx
        .update(equipments)
        .set({ status: 'disponible', updatedAt: new Date() })
        .where(eq(equipments.id, input.equipmentId));
      return toAssignment(row);
    });
  }

  async setEquipmentStatus(
    id: string,
    status: EquipmentStatus,
  ): Promise<EquipmentRecord | null> {
    // Read + guard + UPDATE must commit together under a row lock. Without the
    // transaction + SELECT … FOR UPDATE this is a read-then-write TOCTOU: a
    // concurrent setEquipmentStatus or assignEquipment could observe the same
    // initial status, let assertSetStatus pass twice, and strand an open
    // assignment (e.g. flip an assignee machine to hors_service). Mirrors the
    // transactional shape of assignEquipment / returnEquipment.
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipments)
        .where(eq(equipments.id, id))
        .for('update')
        .limit(1);
      if (!existing) return null;
      assertSetStatus(existing.status as EquipmentStatus, status);
      const [row] = await tx
        .update(equipments)
        .set({ status, updatedAt: new Date() })
        .where(eq(equipments.id, id))
        .returning();
      return row ? toEquipment(row) : null;
    });
  }

  async listAssignments(
    filter: AssignmentFilter,
  ): Promise<EquipmentAssignmentRecord[]> {
    const clauses = [];
    if (filter.projectId) {
      clauses.push(eq(equipmentAssignments.projectId, filter.projectId));
    }
    if (filter.equipmentId) {
      clauses.push(eq(equipmentAssignments.equipmentId, filter.equipmentId));
    }
    if (filter.open) clauses.push(isNull(equipmentAssignments.returnedAt));
    const rows = await this.db
      .select()
      .from(equipmentAssignments)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(equipmentAssignments.assignedAt));
    return rows.map(toAssignment);
  }

  async projectEquipment(
    projectId: string,
  ): Promise<ProjectEquipmentRecord[]> {
    // One INNER JOIN resolves the machines posted to the chantier AND their open
    // assignment in a single round-trip — no per-machine getEquipment fan-out
    // (N+1). The returnedAt-null filter guarantees exactly one open assignment
    // per machine. Uses equipment_assignment_project_id_idx.
    const rows = await this.db
      .select({ equipment: equipments, assignment: equipmentAssignments })
      .from(equipmentAssignments)
      .innerJoin(
        equipments,
        eq(equipments.id, equipmentAssignments.equipmentId),
      )
      .where(
        and(
          eq(equipmentAssignments.projectId, projectId),
          isNull(equipmentAssignments.returnedAt),
        ),
      )
      .orderBy(asc(equipments.name));
    return rows.map((row) => ({
      ...toEquipment(row.equipment),
      openAssignment: toAssignment(row.assignment),
    }));
  }
}

// ── row → record mappers ─────────────────────────────────────────────────────

type EquipmentRow = typeof equipments.$inferSelect;
type AssignmentRow = typeof equipmentAssignments.$inferSelect;

function toEquipment(row: EquipmentRow): EquipmentRecord {
  return {
    id: row.id,
    code: row.code ?? undefined,
    name: row.name,
    category: row.category ?? undefined,
    status: row.status as EquipmentStatus,
    acquisitionDate: row.acquisitionDate ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAssignment(row: AssignmentRow): EquipmentAssignmentRecord {
  return {
    id: row.id,
    equipmentId: row.equipmentId,
    projectId: row.projectId,
    assignedAt: row.assignedAt,
    expectedReturnAt: row.expectedReturnAt ?? undefined,
    returnedAt: row.returnedAt ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}
