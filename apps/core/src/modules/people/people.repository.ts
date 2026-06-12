import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assignments, employees } from '../../db/schema';

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

export interface AssignmentRecord {
  id: string;
  employeeId: string;
  projectId: string;
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
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
  ): Promise<AssignmentRecord>;
  endAssignment(id: string, endDate: Date): Promise<AssignmentRecord | null>;
  listAssignmentsByProject(projectId: string): Promise<AssignmentRecord[]>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryPeopleRepository implements PeopleRepository {
  private employees: readonly EmployeeRecord[] = [];
  private assignments: readonly AssignmentRecord[] = [];

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
  ): Promise<AssignmentRecord> {
    const record: AssignmentRecord = {
      id: randomUUID(),
      employeeId,
      projectId,
      startDate,
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
  ): Promise<AssignmentRecord> {
    const [row] = await this.db
      .insert(assignments)
      .values({ employeeId, projectId, startDate })
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
}

type EmployeeRow = typeof employees.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;

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
    createdAt: row.createdAt,
  };
}
