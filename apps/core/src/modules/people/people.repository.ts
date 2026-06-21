import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assignments, employees, workDays } from '../../db/schema';
import {
  computeProjectLabor,
  type ProjectLabor,
  type RateType,
} from './labor.domain';

export type EmployeeStatus = 'actif' | 'inactif';

export interface CreateEmployee {
  fullName: string;
  metier: string;
  cin?: string;
  phone?: string;
}

export interface EmployeeRecord extends CreateEmployee {
  id: string;
  status: EmployeeStatus;
  createdAt: Date;
}

/** Optional pay basis carried on a new assignment (Phase 3 — labour cost). */
export interface AssignmentRate {
  rateType?: RateType;
  rateAmountMad?: number;
}

export interface AssignmentRecord {
  id: string;
  employeeId: string;
  projectId: string;
  startDate: Date;
  endDate?: Date;
  rateType?: RateType;
  rateAmountMad?: number;
  createdAt: Date;
}

export interface UpsertWorkDayInput {
  assignmentId: string;
  workDate: Date;
  daysWorked: number;
  notes?: string;
}

export interface WorkDayRecord {
  id: string;
  assignmentId: string;
  workDate: Date;
  daysWorked: number;
  notes?: string;
  createdAt: Date;
}

/** A chantier assignment already joined to its worker's name + métier. */
export interface TeamMemberRecord {
  id: string;
  employeeId: string;
  fullName: string;
  metier: string;
  startDate: Date;
  endDate?: Date;
}

export const PEOPLE_REPOSITORY = Symbol('PEOPLE_REPOSITORY');

export interface PeopleRepository {
  createEmployee(input: CreateEmployee): Promise<EmployeeRecord>;
  listEmployees(): Promise<EmployeeRecord[]>;
  findEmployeeById(id: string): Promise<EmployeeRecord | null>;
  /** The single open (endDate null) assignment, if any. */
  findActiveAssignment(employeeId: string): Promise<AssignmentRecord | null>;
  createAssignment(
    employeeId: string,
    projectId: string,
    startDate: Date,
    rate?: AssignmentRate,
  ): Promise<AssignmentRecord>;
  endAssignment(id: string, endDate: Date): Promise<AssignmentRecord | null>;
  listAssignmentsByProject(projectId: string): Promise<AssignmentRecord[]>;
  /**
   * The chantier roster with each worker's name + métier resolved in a single
   * query (no per-assignment employee fetch). Mirrors projectLabor's JOIN.
   */
  listTeamByProject(projectId: string): Promise<TeamMemberRecord[]>;
  findAssignmentById(id: string): Promise<AssignmentRecord | null>;
  /**
   * Logs a work day, or — when (assignmentId, workDate) already exists —
   * replaces its daysWorked + notes (idempotent pointage). Returns the action.
   */
  upsertWorkDay(input: UpsertWorkDayInput): Promise<'inserted' | 'updated'>;
  listWorkDays(assignmentId: string): Promise<WorkDayRecord[]>;
  /** Per-worker dues + project totals, folded from assignments × their pointage. */
  projectLabor(projectId: string): Promise<ProjectLabor>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryPeopleRepository implements PeopleRepository {
  private employees: readonly EmployeeRecord[] = [];
  private assignments: readonly AssignmentRecord[] = [];
  private workDays: readonly WorkDayRecord[] = [];

  async createEmployee(input: CreateEmployee): Promise<EmployeeRecord> {
    const record: EmployeeRecord = {
      ...input,
      id: randomUUID(),
      status: 'actif',
      createdAt: new Date(),
    };
    this.employees = [...this.employees, record];
    return record;
  }

  async listEmployees(): Promise<EmployeeRecord[]> {
    return [...this.employees];
  }

  async findEmployeeById(id: string): Promise<EmployeeRecord | null> {
    return this.employees.find((e) => e.id === id) ?? null;
  }

  async findActiveAssignment(
    employeeId: string,
  ): Promise<AssignmentRecord | null> {
    return (
      this.assignments.find(
        (a) => a.employeeId === employeeId && a.endDate === undefined,
      ) ?? null
    );
  }

  async createAssignment(
    employeeId: string,
    projectId: string,
    startDate: Date,
    rate?: AssignmentRate,
  ): Promise<AssignmentRecord> {
    const record: AssignmentRecord = {
      id: randomUUID(),
      employeeId,
      projectId,
      startDate,
      rateType: rate?.rateType,
      rateAmountMad: rate?.rateAmountMad,
      createdAt: new Date(),
    };
    this.assignments = [...this.assignments, record];
    return record;
  }

  async endAssignment(
    id: string,
    endDate: Date,
  ): Promise<AssignmentRecord | null> {
    const existing = this.assignments.find((a) => a.id === id) ?? null;
    if (!existing) return null;
    const updated: AssignmentRecord = { ...existing, endDate };
    this.assignments = this.assignments.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  async listAssignmentsByProject(
    projectId: string,
  ): Promise<AssignmentRecord[]> {
    return this.assignments.filter((a) => a.projectId === projectId);
  }

  async listTeamByProject(projectId: string): Promise<TeamMemberRecord[]> {
    return this.assignments
      .filter((a) => a.projectId === projectId)
      .flatMap((assignment) => {
        const employee = this.employees.find(
          (e) => e.id === assignment.employeeId,
        );
        if (!employee) return [];
        return [
          {
            id: assignment.id,
            employeeId: assignment.employeeId,
            fullName: employee.fullName,
            metier: employee.metier,
            startDate: assignment.startDate,
            endDate: assignment.endDate,
          },
        ];
      });
  }

  async findAssignmentById(id: string): Promise<AssignmentRecord | null> {
    return this.assignments.find((a) => a.id === id) ?? null;
  }

  async upsertWorkDay(
    input: UpsertWorkDayInput,
  ): Promise<'inserted' | 'updated'> {
    const index = this.workDays.findIndex(
      (w) =>
        w.assignmentId === input.assignmentId &&
        sameDay(w.workDate, input.workDate),
    );
    if (index === -1) {
      this.workDays = [
        ...this.workDays,
        { ...input, id: randomUUID(), createdAt: new Date() },
      ];
      return 'inserted';
    }
    // Idempotent pointage: replace daysWorked + notes, never duplicate the day.
    const existing = this.workDays[index]!;
    const merged: WorkDayRecord = {
      ...existing,
      daysWorked: input.daysWorked,
      notes: input.notes,
    };
    this.workDays = [
      ...this.workDays.slice(0, index),
      merged,
      ...this.workDays.slice(index + 1),
    ];
    return 'updated';
  }

  async listWorkDays(assignmentId: string): Promise<WorkDayRecord[]> {
    return this.workDays
      .filter((w) => w.assignmentId === assignmentId)
      .sort((a, b) => a.workDate.getTime() - b.workDate.getTime());
  }

  async projectLabor(projectId: string): Promise<ProjectLabor> {
    const projectAssignments = this.assignments.filter(
      (a) => a.projectId === projectId,
    );
    const withDays = projectAssignments.map((assignment) => {
      const employee = this.employees.find((e) => e.id === assignment.employeeId);
      const totalDays = this.workDays
        .filter((w) => w.assignmentId === assignment.id)
        .reduce((sum, w) => sum + w.daysWorked, 0);
      return {
        employeeId: assignment.employeeId,
        fullName: employee?.fullName ?? assignment.employeeId,
        metier: employee?.metier ?? '',
        rateType: assignment.rateType,
        rateAmountMad: assignment.rateAmountMad,
        totalDays,
      };
    });
    return computeProjectLabor(withDays);
  }
}

/** Same calendar day, ignoring time — the in-memory (assignment, date) key. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export class DrizzlePeopleRepository implements PeopleRepository {
  constructor(private readonly db: Db) {}

  async createEmployee(input: CreateEmployee): Promise<EmployeeRecord> {
    const [row] = await this.db.insert(employees).values(input).returning();
    if (!row) throw new Error('Employee insert returned no row');
    return toEmployee(row);
  }

  async listEmployees(): Promise<EmployeeRecord[]> {
    const rows = await this.db
      .select()
      .from(employees)
      .orderBy(desc(employees.createdAt));
    return rows.map(toEmployee);
  }

  async findEmployeeById(id: string): Promise<EmployeeRecord | null> {
    const [row] = await this.db
      .select()
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    return row ? toEmployee(row) : null;
  }

  async findActiveAssignment(
    employeeId: string,
  ): Promise<AssignmentRecord | null> {
    const [row] = await this.db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.employeeId, employeeId), isNull(assignments.endDate)),
      )
      .limit(1);
    return row ? toAssignment(row) : null;
  }

  async createAssignment(
    employeeId: string,
    projectId: string,
    startDate: Date,
    rate?: AssignmentRate,
  ): Promise<AssignmentRecord> {
    const [row] = await this.db
      .insert(assignments)
      .values({
        employeeId,
        projectId,
        startDate,
        rateType: rate?.rateType,
        rateAmountMad: rate?.rateAmountMad?.toString(),
      })
      .returning();
    if (!row) throw new Error('Assignment insert returned no row');
    return toAssignment(row);
  }

  async endAssignment(
    id: string,
    endDate: Date,
  ): Promise<AssignmentRecord | null> {
    const [row] = await this.db
      .update(assignments)
      .set({ endDate })
      .where(eq(assignments.id, id))
      .returning();
    return row ? toAssignment(row) : null;
  }

  async listAssignmentsByProject(
    projectId: string,
  ): Promise<AssignmentRecord[]> {
    const rows = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.projectId, projectId));
    return rows.map(toAssignment);
  }

  async listTeamByProject(projectId: string): Promise<TeamMemberRecord[]> {
    // One INNER JOIN resolves every worker's name + métier — no N+1 loop of
    // findEmployeeById per assignment. Inner (not left) join because the team
    // view only shows assignments whose employee exists, matching the old loop
    // which skipped rows where the employee lookup came back empty.
    const rows = await this.db
      .select({
        id: assignments.id,
        employeeId: assignments.employeeId,
        fullName: employees.fullName,
        metier: employees.metier,
        startDate: assignments.startDate,
        endDate: assignments.endDate,
      })
      .from(assignments)
      .innerJoin(employees, eq(employees.id, assignments.employeeId))
      .where(eq(assignments.projectId, projectId))
      .orderBy(asc(assignments.startDate));
    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      fullName: row.fullName,
      metier: row.metier,
      startDate: row.startDate,
      endDate: row.endDate ?? undefined,
    }));
  }

  async findAssignmentById(id: string): Promise<AssignmentRecord | null> {
    const [row] = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    return row ? toAssignment(row) : null;
  }

  async upsertWorkDay(
    input: UpsertWorkDayInput,
  ): Promise<'inserted' | 'updated'> {
    // One atomic INSERT … ON CONFLICT keyed on the (assignment_id, work_date)
    // unique index, so a re-submitted pointage replaces the day instead of
    // double-counting it in the labour-cost rollup. Unlike the intel/stock
    // back-fill upserts, a pointage is a correction: daysWorked + notes are
    // overwritten with the incoming values (excluded.*). (xmax = 0) is the
    // Postgres idiom for "this RETURNING row was freshly inserted" — xmax is 0
    // on a plain INSERT and non-zero after a DO UPDATE.
    const [row] = await this.db
      .insert(workDays)
      .values({
        assignmentId: input.assignmentId,
        workDate: input.workDate,
        daysWorked: input.daysWorked.toString(),
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [workDays.assignmentId, workDays.workDate],
        set: {
          daysWorked: sql`excluded.days_worked`,
          notes: sql`excluded.notes`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return row?.inserted ? 'inserted' : 'updated';
  }

  async listWorkDays(assignmentId: string): Promise<WorkDayRecord[]> {
    const rows = await this.db
      .select()
      .from(workDays)
      .where(eq(workDays.assignmentId, assignmentId))
      .orderBy(asc(workDays.workDate));
    return rows.map(toWorkDay);
  }

  async projectLabor(projectId: string): Promise<ProjectLabor> {
    // Per-assignment day total joined to the worker's name/métier, summed in SQL
    // (left join so an assignment with no pointage still surfaces, totalDays 0),
    // then folded to dues by labor.domain — one costing definition, two stores.
    const rows = await this.db
      .select({
        employeeId: assignments.employeeId,
        fullName: employees.fullName,
        metier: employees.metier,
        rateType: assignments.rateType,
        rateAmountMad: assignments.rateAmountMad,
        totalDays: sql<string>`coalesce(sum(${workDays.daysWorked}), 0)`,
      })
      .from(assignments)
      .innerJoin(employees, eq(employees.id, assignments.employeeId))
      .leftJoin(workDays, eq(workDays.assignmentId, assignments.id))
      .where(eq(assignments.projectId, projectId))
      .groupBy(
        assignments.id,
        assignments.employeeId,
        employees.fullName,
        employees.metier,
        assignments.rateType,
        assignments.rateAmountMad,
      );
    return computeProjectLabor(
      rows.map((row) => ({
        employeeId: row.employeeId,
        fullName: row.fullName,
        metier: row.metier,
        rateType: (row.rateType as RateType | null) ?? undefined,
        rateAmountMad: row.rateAmountMad ? Number(row.rateAmountMad) : undefined,
        totalDays: Number(row.totalDays),
      })),
    );
  }
}

type EmployeeRow = typeof employees.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;
type WorkDayRow = typeof workDays.$inferSelect;

function toEmployee(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    metier: row.metier,
    cin: row.cin ?? undefined,
    phone: row.phone ?? undefined,
    status: row.status as EmployeeStatus,
    createdAt: row.createdAt,
  };
}

function toAssignment(row: AssignmentRow): AssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    projectId: row.projectId,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    rateType: (row.rateType as RateType | null) ?? undefined,
    rateAmountMad: row.rateAmountMad ? Number(row.rateAmountMad) : undefined,
    createdAt: row.createdAt,
  };
}

function toWorkDay(row: WorkDayRow): WorkDayRecord {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    workDate: row.workDate,
    daysWorked: Number(row.daysWorked),
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}
