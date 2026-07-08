/**
 * Matériel & engins — repository contract + InMemory and Drizzle stores.
 * upsertEquipment back-fills on (companyId, name) like the stock/sales upserts.
 * assignEquipment / returnEquipment / setEquipmentStatus are TRANSACTIONAL: they
 * SELECT … FOR UPDATE the machine row (serialising concurrent moves on the same
 * machine), guard the move via equipment.domain, then write the assignment row
 * AND flip equipment.status in one commit (mirrors the Phase-5 sales
 * db.transaction), so the inventory status and the open-assignment log never
 * disagree under READ COMMITTED. Dates use Drizzle's date mode 'date'; money is
 * numeric (returned as string → mapped to Number). InMemory ↔ Drizzle keep
 * strict behavioural parity (the single-threaded InMemory store has no
 * concurrency window, so it needs no lock).
 *
 * The GMAO layer (documents / meters / work orders) hangs off the register: a
 * machine carries compliance documents with expiry, a usage-meter reading log,
 * and work orders (bons d'intervention) whose costs roll up per machine.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  equipmentAssignments,
  equipmentDocuments,
  equipmentMeterReadings,
  equipments,
  equipmentWorkOrders,
} from '../../db/schema';
import {
  assertAssign,
  assertReturn,
  assertSetStatus,
  EquipmentTransitionError,
  type EquipmentStatus,
} from './equipment.domain';
import {
  assertWorkOrderTransition,
  currentMeterValue,
  documentExpiryStatus,
  type DocumentExpiryStatus,
  type EquipmentDocumentType,
  type MeterUnit,
  type WorkOrderStatus,
  type WorkOrderType,
} from './equipment.maintenance.domain';

// ── inputs & records ─────────────────────────────────────────────────────────

export interface UpsertEquipment {
  name: string;
  code?: string;
  category?: string;
  marque?: string;
  modele?: string;
  numeroSerie?: string;
  immatriculation?: string;
  acquisitionDate?: Date;
  notes?: string;
}

export interface EquipmentRecord {
  id: string;
  code?: string;
  name: string;
  category?: string;
  marque?: string;
  modele?: string;
  numeroSerie?: string;
  immatriculation?: string;
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

// ── Pagination (datao-parity: DB-side LIMIT/OFFSET; counts via a summary) ─────

/** DB-side page window. limit is bounded by the controller (default 25/max 100). */
export interface PageParams {
  limit: number;
  offset: number;
}

/** A single page plus the total matching-row count (for the pager). */
export interface Paged<T> {
  items: T[];
  total: number;
}

/**
 * DB-computed fleet status tallies over the WHOLE table — correct regardless of
 * paging (three JS `.filter().length` over one page would only count that page).
 * `total` is the sum of the per-status counts (whole parc).
 */
export interface EquipmentSummary {
  counts: Record<EquipmentStatus, number>;
  total: number;
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

// ── GMAO: documents / meters / work orders ───────────────────────────────────

export interface AddDocumentInput {
  equipmentId: string;
  type: EquipmentDocumentType;
  reference?: string;
  issueDate?: Date;
  expiryDate?: Date;
  notes?: string;
}

export interface EquipmentDocumentRecord {
  id: string;
  equipmentId: string;
  type: EquipmentDocumentType;
  reference?: string;
  issueDate?: Date;
  expiryDate?: Date;
  notes?: string;
  createdAt: Date;
}

/**
 * A document that needs attention (expired or expiring within the window),
 * carrying its machine name + computed status for the fleet alerts panel.
 */
export interface ExpiringDocument extends EquipmentDocumentRecord {
  equipmentName: string;
  status: DocumentExpiryStatus;
}

export interface AddMeterReadingInput {
  equipmentId: string;
  readingDate: Date;
  value: number;
  unit: MeterUnit;
  source?: string;
  notes?: string;
}

export interface EquipmentMeterReadingRecord {
  id: string;
  equipmentId: string;
  readingDate: Date;
  value: number;
  unit: MeterUnit;
  source: string;
  notes?: string;
  createdAt: Date;
}

/** The machine's current meter: latest reading value + its unit. */
export interface CurrentMeter {
  value: number;
  unit: MeterUnit;
}

export interface CreateWorkOrderInput {
  equipmentId: string;
  type: WorkOrderType;
  title: string;
  description?: string;
  reportedBy?: string;
  openedAt: Date;
  meterAtService?: number;
  costMad?: number;
}

export interface EquipmentWorkOrderRecord {
  id: string;
  equipmentId: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  title: string;
  description?: string;
  reportedBy?: string;
  openedAt: Date;
  completedAt?: Date;
  meterAtService?: number;
  costMad?: number;
  resolution?: string;
  createdAt: Date;
}

/** Status change + optional completion metadata for a work order. */
export interface SetWorkOrderStatusInput {
  status: WorkOrderStatus;
  completedAt?: Date;
  costMad?: number;
  resolution?: string;
  meterAtService?: number;
}

export interface WorkOrderFilter {
  equipmentId?: string;
  status?: WorkOrderStatus;
}

export const EQUIPMENT_REPOSITORY = Symbol('EQUIPMENT_REPOSITORY');

export interface EquipmentRepository {
  /** Inserts a machine, or back-fills it when (companyId, name) exists. */
  upsertEquipment(input: UpsertEquipment): Promise<EquipmentRecord>;
  /** One DB page of fleet rows + the total matching count (for the pager). */
  listEquipment(
    filter: EquipmentFilter,
    paging: PageParams,
  ): Promise<Paged<EquipmentRecord>>;
  /** DB-side fleet status tallies over the whole parc (paging-independent). */
  equipmentSummary(): Promise<EquipmentSummary>;
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

  // ── GMAO: documents ────────────────────────────────────────────────────────
  /** Records a compliance document (assurance, carte grise…) for a machine. */
  addDocument(input: AddDocumentInput): Promise<EquipmentDocumentRecord>;
  /** A machine's documents, soonest expiry first (permanent docs last). */
  listDocuments(equipmentId: string): Promise<EquipmentDocumentRecord[]>;
  /** Removes a document; true when a row was deleted. */
  deleteDocument(id: string): Promise<boolean>;
  /**
   * Fleet-wide documents that are expired or expiring within `withinDays` of
   * `today`, each with its machine name + computed status, soonest expiry first.
   */
  expiringDocuments(
    withinDays: number,
    today: Date,
  ): Promise<ExpiringDocument[]>;

  // ── GMAO: meters ───────────────────────────────────────────────────────────
  /** Appends a usage-meter reading (heures / km). */
  addMeterReading(
    input: AddMeterReadingInput,
  ): Promise<EquipmentMeterReadingRecord>;
  /** A machine's reading log, newest reading date first. */
  listMeterReadings(
    equipmentId: string,
  ): Promise<EquipmentMeterReadingRecord[]>;
  /** The machine's current meter (latest reading), null when none recorded. */
  currentMeter(equipmentId: string): Promise<CurrentMeter | null>;

  // ── GMAO: work orders ──────────────────────────────────────────────────────
  /** Opens a work order (bon d'intervention) in status 'ouvert'. */
  createWorkOrder(
    input: CreateWorkOrderInput,
  ): Promise<EquipmentWorkOrderRecord>;
  /** Work orders matching the filter, newest opened first. */
  listWorkOrders(filter: WorkOrderFilter): Promise<EquipmentWorkOrderRecord[]>;
  /**
   * Moves a work order along its lifecycle (guarded by assertWorkOrderTransition)
   * and applies optional completion metadata. Null when the id is unknown.
   */
  setWorkOrderStatus(
    id: string,
    input: SetWorkOrderStatusInput,
  ): Promise<EquipmentWorkOrderRecord | null>;
  /** Total intervention cost (sum of work-order cost_mad) for a machine, in MAD. */
  equipmentCost(equipmentId: string): Promise<number>;
}

// ── in-memory store (dev/test fallback) ──────────────────────────────────────

/** Newest reading first; same-date ties broken by later insertion (createdAt). */
function latestReadingFirst(
  a: { readingDate: Date; createdAt: Date },
  b: { readingDate: Date; createdAt: Date },
): number {
  const byDate = b.readingDate.getTime() - a.readingDate.getTime();
  if (byDate !== 0) return byDate;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/** Compliance documents ordered soonest-expiry-first; permanent (null) last. */
function byExpiryAsc(a: { expiryDate?: Date }, b: { expiryDate?: Date }): number {
  const av = a.expiryDate ? a.expiryDate.getTime() : Number.POSITIVE_INFINITY;
  const bv = b.expiryDate ? b.expiryDate.getTime() : Number.POSITIVE_INFINITY;
  return av - bv;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryEquipmentRepository implements EquipmentRepository {
  private equipment: readonly EquipmentRecord[] = [];
  private assignments: readonly EquipmentAssignmentRecord[] = [];
  private documents: readonly EquipmentDocumentRecord[] = [];
  private meterReadings: readonly EquipmentMeterReadingRecord[] = [];
  private workOrders: readonly EquipmentWorkOrderRecord[] = [];

  async upsertEquipment(input: UpsertEquipment): Promise<EquipmentRecord> {
    const index = this.equipment.findIndex((e) => e.name === input.name);
    if (index === -1) {
      const now = new Date();
      const record: EquipmentRecord = {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        category: input.category,
        marque: input.marque,
        modele: input.modele,
        numeroSerie: input.numeroSerie,
        immatriculation: input.immatriculation,
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
      marque: input.marque ?? existing.marque,
      modele: input.modele ?? existing.modele,
      numeroSerie: input.numeroSerie ?? existing.numeroSerie,
      immatriculation: input.immatriculation ?? existing.immatriculation,
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

  async listEquipment(
    filter: EquipmentFilter,
    paging: PageParams,
  ): Promise<Paged<EquipmentRecord>> {
    const matched = [...this.equipment]
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = matched.slice(paging.offset, paging.offset + paging.limit);
    return { items, total: matched.length };
  }

  async equipmentSummary(): Promise<EquipmentSummary> {
    // Tallies over the WHOLE parc (not one page): a JS filter over a single page
    // would only count that page. Seed every status at 0 so absent buckets show.
    const counts: Record<EquipmentStatus, number> = {
      disponible: 0,
      assignee: 0,
      hors_service: 0,
    };
    for (const machine of this.equipment) counts[machine.status] += 1;
    return { counts, total: this.equipment.length };
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

  // ── GMAO: documents ────────────────────────────────────────────────────────

  async addDocument(input: AddDocumentInput): Promise<EquipmentDocumentRecord> {
    const record: EquipmentDocumentRecord = {
      id: randomUUID(),
      equipmentId: input.equipmentId,
      type: input.type,
      reference: input.reference,
      issueDate: input.issueDate,
      expiryDate: input.expiryDate,
      notes: input.notes,
      createdAt: new Date(),
    };
    this.documents = [...this.documents, record];
    return record;
  }

  async listDocuments(
    equipmentId: string,
  ): Promise<EquipmentDocumentRecord[]> {
    return [...this.documents]
      .filter((d) => d.equipmentId === equipmentId)
      .sort(byExpiryAsc);
  }

  async deleteDocument(id: string): Promise<boolean> {
    const next = this.documents.filter((d) => d.id !== id);
    const deleted = next.length !== this.documents.length;
    this.documents = next;
    return deleted;
  }

  async expiringDocuments(
    withinDays: number,
    today: Date,
  ): Promise<ExpiringDocument[]> {
    const nameById = new Map(this.equipment.map((e) => [e.id, e.name]));
    return this.documents
      .map((doc) => ({
        doc,
        status: documentExpiryStatus(doc.expiryDate, today, withinDays),
      }))
      .filter((x) => x.status === 'expire' || x.status === 'expire_bientot')
      .sort((a, b) => byExpiryAsc(a.doc, b.doc))
      .map(({ doc, status }) => ({
        ...doc,
        equipmentName: nameById.get(doc.equipmentId) ?? '—',
        status,
      }));
  }

  // ── GMAO: meters ───────────────────────────────────────────────────────────

  async addMeterReading(
    input: AddMeterReadingInput,
  ): Promise<EquipmentMeterReadingRecord> {
    const record: EquipmentMeterReadingRecord = {
      id: randomUUID(),
      equipmentId: input.equipmentId,
      readingDate: input.readingDate,
      value: input.value,
      unit: input.unit,
      source: input.source ?? 'manuel',
      notes: input.notes,
      createdAt: new Date(),
    };
    this.meterReadings = [...this.meterReadings, record];
    return record;
  }

  async listMeterReadings(
    equipmentId: string,
  ): Promise<EquipmentMeterReadingRecord[]> {
    return [...this.meterReadings]
      .filter((r) => r.equipmentId === equipmentId)
      .sort(latestReadingFirst);
  }

  async currentMeter(equipmentId: string): Promise<CurrentMeter | null> {
    const readings = this.meterReadings.filter(
      (r) => r.equipmentId === equipmentId,
    );
    const value = currentMeterValue(readings);
    if (value === null) return null;
    const [latest] = [...readings].sort(latestReadingFirst);
    return { value, unit: latest!.unit };
  }

  // ── GMAO: work orders ──────────────────────────────────────────────────────

  async createWorkOrder(
    input: CreateWorkOrderInput,
  ): Promise<EquipmentWorkOrderRecord> {
    const record: EquipmentWorkOrderRecord = {
      id: randomUUID(),
      equipmentId: input.equipmentId,
      type: input.type,
      status: 'ouvert',
      title: input.title,
      description: input.description,
      reportedBy: input.reportedBy,
      openedAt: input.openedAt,
      completedAt: undefined,
      meterAtService: input.meterAtService,
      costMad: input.costMad,
      resolution: undefined,
      createdAt: new Date(),
    };
    this.workOrders = [...this.workOrders, record];
    return record;
  }

  async listWorkOrders(
    filter: WorkOrderFilter,
  ): Promise<EquipmentWorkOrderRecord[]> {
    return [...this.workOrders]
      .filter((w) => {
        if (filter.equipmentId && w.equipmentId !== filter.equipmentId) {
          return false;
        }
        if (filter.status && w.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => {
        const byOpened = b.openedAt.getTime() - a.openedAt.getTime();
        if (byOpened !== 0) return byOpened;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  async setWorkOrderStatus(
    id: string,
    input: SetWorkOrderStatusInput,
  ): Promise<EquipmentWorkOrderRecord | null> {
    const index = this.workOrders.findIndex((w) => w.id === id);
    if (index === -1) return null;
    const existing = this.workOrders[index]!;
    assertWorkOrderTransition(existing.status, input.status);
    const updated: EquipmentWorkOrderRecord = {
      ...existing,
      status: input.status,
      completedAt: input.completedAt ?? existing.completedAt,
      costMad: input.costMad ?? existing.costMad,
      resolution: input.resolution ?? existing.resolution,
      meterAtService: input.meterAtService ?? existing.meterAtService,
    };
    this.workOrders = [
      ...this.workOrders.slice(0, index),
      updated,
      ...this.workOrders.slice(index + 1),
    ];
    return updated;
  }

  async equipmentCost(equipmentId: string): Promise<number> {
    return this.workOrders
      .filter((w) => w.equipmentId === equipmentId && w.costMad != null)
      .reduce((sum, w) => sum + (w.costMad ?? 0), 0);
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
        marque: input.marque,
        modele: input.modele,
        numeroSerie: input.numeroSerie,
        immatriculation: input.immatriculation,
        acquisitionDate: input.acquisitionDate,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [equipments.companyId, equipments.name],
        set: {
          code: sql`coalesce(excluded.code, ${equipments.code})`,
          category: sql`coalesce(excluded.category, ${equipments.category})`,
          marque: sql`coalesce(excluded.marque, ${equipments.marque})`,
          modele: sql`coalesce(excluded.modele, ${equipments.modele})`,
          numeroSerie: sql`coalesce(excluded.numero_serie, ${equipments.numeroSerie})`,
          immatriculation: sql`coalesce(excluded.immatriculation, ${equipments.immatriculation})`,
          acquisitionDate: sql`coalesce(excluded.acquisition_date, ${equipments.acquisitionDate})`,
          notes: sql`coalesce(excluded.notes, ${equipments.notes})`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    if (!row) throw new Error('Equipment upsert returned no row');
    return toEquipment(row);
  }

  async listEquipment(
    filter: EquipmentFilter,
    paging: PageParams,
  ): Promise<Paged<EquipmentRecord>> {
    // DB-side page: keep the existing ORDER BY + optional status filter, add
    // LIMIT/OFFSET, and count the whole filtered set in parallel so the pager
    // knows how many pages exist. Mirrors the Phase-6 sales listInvoices shape.
    const where = filter.status
      ? eq(equipments.status, filter.status)
      : undefined;
    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(equipments)
        .where(where)
        .orderBy(desc(equipments.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(equipments)
        .where(where),
    ]);
    return {
      items: rows.map(toEquipment),
      total: Number(countRow?.total ?? 0),
    };
  }

  async equipmentSummary(): Promise<EquipmentSummary> {
    // SELECT status, count(*) GROUP BY status over the whole parc — one round-trip
    // for all three tallies, correct regardless of paging. Seed every status at 0
    // so a bucket with no rows still renders its KPI tile.
    const rows = await this.db
      .select({ status: equipments.status, count: sql<number>`count(*)` })
      .from(equipments)
      .groupBy(equipments.status);
    const counts: Record<EquipmentStatus, number> = {
      disponible: 0,
      assignee: 0,
      hors_service: 0,
    };
    let total = 0;
    for (const row of rows) {
      const n = Number(row.count ?? 0);
      counts[row.status as EquipmentStatus] = n;
      total += n;
    }
    return { counts, total };
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

  // ── GMAO: documents ────────────────────────────────────────────────────────

  async addDocument(input: AddDocumentInput): Promise<EquipmentDocumentRecord> {
    const [row] = await this.db
      .insert(equipmentDocuments)
      .values({
        equipmentId: input.equipmentId,
        type: input.type,
        reference: input.reference,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Document insert returned no row');
    return toDocument(row);
  }

  async listDocuments(
    equipmentId: string,
  ): Promise<EquipmentDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(equipmentDocuments)
      .where(eq(equipmentDocuments.equipmentId, equipmentId))
      .orderBy(asc(equipmentDocuments.expiryDate));
    return rows.map(toDocument);
  }

  async deleteDocument(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(equipmentDocuments)
      .where(eq(equipmentDocuments.id, id))
      .returning({ id: equipmentDocuments.id });
    return rows.length > 0;
  }

  async expiringDocuments(
    withinDays: number,
    today: Date,
  ): Promise<ExpiringDocument[]> {
    // Reduce to rows expiring on/before (today + withinDays) — this excludes
    // permanent (null expiry) and still-valid docs — then compute the badge
    // status per row in JS so it matches the InMemory path exactly.
    const cutoff = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + withinDays,
      ),
    );
    const rows = await this.db
      .select({ doc: equipmentDocuments, name: equipments.name })
      .from(equipmentDocuments)
      .innerJoin(
        equipments,
        eq(equipments.id, equipmentDocuments.equipmentId),
      )
      .where(lte(equipmentDocuments.expiryDate, cutoff))
      .orderBy(asc(equipmentDocuments.expiryDate));
    return rows.map((row) => ({
      ...toDocument(row.doc),
      equipmentName: row.name,
      status: documentExpiryStatus(
        row.doc.expiryDate ?? undefined,
        today,
        withinDays,
      ),
    }));
  }

  // ── GMAO: meters ───────────────────────────────────────────────────────────

  async addMeterReading(
    input: AddMeterReadingInput,
  ): Promise<EquipmentMeterReadingRecord> {
    const [row] = await this.db
      .insert(equipmentMeterReadings)
      .values({
        equipmentId: input.equipmentId,
        readingDate: input.readingDate,
        value: String(input.value),
        unit: input.unit,
        source: input.source ?? 'manuel',
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Meter reading insert returned no row');
    return toMeterReading(row);
  }

  async listMeterReadings(
    equipmentId: string,
  ): Promise<EquipmentMeterReadingRecord[]> {
    const rows = await this.db
      .select()
      .from(equipmentMeterReadings)
      .where(eq(equipmentMeterReadings.equipmentId, equipmentId))
      .orderBy(
        desc(equipmentMeterReadings.readingDate),
        desc(equipmentMeterReadings.createdAt),
      );
    return rows.map(toMeterReading);
  }

  async currentMeter(equipmentId: string): Promise<CurrentMeter | null> {
    const [row] = await this.db
      .select()
      .from(equipmentMeterReadings)
      .where(eq(equipmentMeterReadings.equipmentId, equipmentId))
      .orderBy(
        desc(equipmentMeterReadings.readingDate),
        desc(equipmentMeterReadings.createdAt),
      )
      .limit(1);
    if (!row) return null;
    return { value: Number(row.value), unit: row.unit as MeterUnit };
  }

  // ── GMAO: work orders ──────────────────────────────────────────────────────

  async createWorkOrder(
    input: CreateWorkOrderInput,
  ): Promise<EquipmentWorkOrderRecord> {
    const [row] = await this.db
      .insert(equipmentWorkOrders)
      .values({
        equipmentId: input.equipmentId,
        type: input.type,
        title: input.title,
        description: input.description,
        reportedBy: input.reportedBy,
        openedAt: input.openedAt,
        meterAtService:
          input.meterAtService != null
            ? String(input.meterAtService)
            : undefined,
        costMad: input.costMad != null ? String(input.costMad) : undefined,
      })
      .returning();
    if (!row) throw new Error('Work order insert returned no row');
    return toWorkOrder(row);
  }

  async listWorkOrders(
    filter: WorkOrderFilter,
  ): Promise<EquipmentWorkOrderRecord[]> {
    const clauses = [];
    if (filter.equipmentId) {
      clauses.push(eq(equipmentWorkOrders.equipmentId, filter.equipmentId));
    }
    if (filter.status) {
      clauses.push(eq(equipmentWorkOrders.status, filter.status));
    }
    const rows = await this.db
      .select()
      .from(equipmentWorkOrders)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(
        desc(equipmentWorkOrders.openedAt),
        desc(equipmentWorkOrders.createdAt),
      );
    return rows.map(toWorkOrder);
  }

  async setWorkOrderStatus(
    id: string,
    input: SetWorkOrderStatusInput,
  ): Promise<EquipmentWorkOrderRecord | null> {
    // Read + guard + UPDATE under a row lock so two concurrent status changes on
    // the same work order can't both pass assertWorkOrderTransition from the same
    // observed status. Mirrors setEquipmentStatus.
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipmentWorkOrders)
        .where(eq(equipmentWorkOrders.id, id))
        .for('update')
        .limit(1);
      if (!existing) return null;
      assertWorkOrderTransition(
        existing.status as WorkOrderStatus,
        input.status,
      );
      const [row] = await tx
        .update(equipmentWorkOrders)
        .set({
          status: input.status,
          completedAt: input.completedAt ?? existing.completedAt,
          resolution: input.resolution ?? existing.resolution,
          costMad:
            input.costMad != null ? String(input.costMad) : existing.costMad,
          meterAtService:
            input.meterAtService != null
              ? String(input.meterAtService)
              : existing.meterAtService,
        })
        .where(eq(equipmentWorkOrders.id, id))
        .returning();
      return row ? toWorkOrder(row) : null;
    });
  }

  async equipmentCost(equipmentId: string): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${equipmentWorkOrders.costMad}), 0)`,
      })
      .from(equipmentWorkOrders)
      .where(eq(equipmentWorkOrders.equipmentId, equipmentId));
    return Number(row?.total ?? 0);
  }
}

// ── row → record mappers ─────────────────────────────────────────────────────

type EquipmentRow = typeof equipments.$inferSelect;
type AssignmentRow = typeof equipmentAssignments.$inferSelect;
type DocumentRow = typeof equipmentDocuments.$inferSelect;
type MeterReadingRow = typeof equipmentMeterReadings.$inferSelect;
type WorkOrderRow = typeof equipmentWorkOrders.$inferSelect;

function toEquipment(row: EquipmentRow): EquipmentRecord {
  return {
    id: row.id,
    code: row.code ?? undefined,
    name: row.name,
    category: row.category ?? undefined,
    marque: row.marque ?? undefined,
    modele: row.modele ?? undefined,
    numeroSerie: row.numeroSerie ?? undefined,
    immatriculation: row.immatriculation ?? undefined,
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

function toDocument(row: DocumentRow): EquipmentDocumentRecord {
  return {
    id: row.id,
    equipmentId: row.equipmentId,
    type: row.type as EquipmentDocumentType,
    reference: row.reference ?? undefined,
    issueDate: row.issueDate ?? undefined,
    expiryDate: row.expiryDate ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

function toMeterReading(row: MeterReadingRow): EquipmentMeterReadingRecord {
  return {
    id: row.id,
    equipmentId: row.equipmentId,
    readingDate: row.readingDate,
    value: Number(row.value),
    unit: row.unit as MeterUnit,
    source: row.source,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

function toWorkOrder(row: WorkOrderRow): EquipmentWorkOrderRecord {
  return {
    id: row.id,
    equipmentId: row.equipmentId,
    type: row.type as WorkOrderType,
    status: row.status as WorkOrderStatus,
    title: row.title,
    description: row.description ?? undefined,
    reportedBy: row.reportedBy ?? undefined,
    openedAt: row.openedAt,
    completedAt: row.completedAt ?? undefined,
    meterAtService:
      row.meterAtService != null ? Number(row.meterAtService) : undefined,
    costMad: row.costMad != null ? Number(row.costMad) : undefined,
    resolution: row.resolution ?? undefined,
    createdAt: row.createdAt,
  };
}
