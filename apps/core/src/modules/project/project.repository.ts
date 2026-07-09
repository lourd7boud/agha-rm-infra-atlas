import { randomUUID } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { avenants, projects, situations, tasks } from '../../db/schema';
import { normalizeTaskPatch, type TaskPatch, type TaskStatus } from './task.domain';

export type ProjectStatus =
  | 'preparation'
  | 'en_cours'
  | 'suspendu'
  | 'receptionne'
  | 'clos';

export type SituationStatus = 'brouillon' | 'soumis' | 'valide' | 'paye';

export interface CreateProject {
  reference: string;
  name: string;
  buyerName: string;
  montantMarcheMad: number;
  tenderId?: string;
  ordreServiceDate?: Date;
  delaiMois?: number;
}

export interface ProjectRecord extends CreateProject {
  id: string;
  status: ProjectStatus;
  createdAt: Date;
}

export interface CreateSituation {
  projectId: string;
  numero: number;
  periodEnd: Date;
  montantCumuleMad: number;
  montantPeriodeMad: number;
  retenueGarantieMad: number;
  netAPayerMad: number;
  avancementPct: number;
  notes?: string;
}

export interface SituationRecord extends CreateSituation {
  id: string;
  status: SituationStatus;
  createdAt: Date;
}

/**
 * A situation flattened with its owning project's identity, as produced by a
 * single project⋈situation join. Avoids a per-project query when the whole
 * portfolio's situations are needed at once (e.g. finance receivables aging).
 */
export interface SituationWithProject extends SituationRecord {
  projectReference: string;
  buyerName: string;
}

export interface CreateAvenant {
  projectId: string;
  numero: number;
  objet: string;
  montantDeltaMad: number;
  delaiDeltaMois: number;
  approvedAt: Date;
}

export interface AvenantRecord extends CreateAvenant {
  id: string;
  createdAt: Date;
}

export interface CreateTask {
  projectId: string;
  label: string;
  description?: string;
  progressPct?: number;
  status?: TaskStatus;
  startDate?: Date;
  dueDate?: Date;
  orderIndex?: number;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  label: string;
  description?: string;
  progressPct: number;
  status: TaskStatus;
  startDate?: Date;
  dueDate?: Date;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface ProjectRepository {
  create(input: CreateProject): Promise<ProjectRecord>;
  findAll(): Promise<ProjectRecord[]>;
  findById(id: string): Promise<ProjectRecord | null>;
  updateStatus(id: string, status: ProjectStatus): Promise<ProjectRecord | null>;
  listSituations(projectId: string): Promise<SituationRecord[]>;
  /**
   * Every situation across every project, each joined to its project's
   * reference + buyerName. One query for the whole portfolio — lets the finance
   * receivables view avoid an N+1 (findAll + listSituations per project).
   */
  listAllSituations(): Promise<SituationWithProject[]>;
  createSituation(input: CreateSituation): Promise<SituationRecord>;
  listAvenants(projectId: string): Promise<AvenantRecord[]>;
  createAvenant(input: CreateAvenant): Promise<AvenantRecord>;
  findSituationById(id: string): Promise<SituationRecord | null>;
  updateSituationStatus(
    id: string,
    status: SituationStatus,
  ): Promise<SituationRecord | null>;
  createTask(input: CreateTask): Promise<TaskRecord>;
  listTasksByProject(projectId: string): Promise<TaskRecord[]>;
  findTaskById(id: string): Promise<TaskRecord | null>;
  updateTask(id: string, patch: TaskPatch): Promise<TaskRecord | null>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryProjectRepository implements ProjectRepository {
  private projects: readonly ProjectRecord[] = [];
  private situations: readonly SituationRecord[] = [];

  async create(input: CreateProject): Promise<ProjectRecord> {
    const record: ProjectRecord = {
      ...input,
      id: randomUUID(),
      status: 'preparation',
      createdAt: new Date(),
    };
    this.projects = [...this.projects, record];
    return record;
  }

  async findAll(): Promise<ProjectRecord[]> {
    return [...this.projects];
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  async updateStatus(
    id: string,
    status: ProjectStatus,
  ): Promise<ProjectRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: ProjectRecord = { ...existing, status };
    this.projects = this.projects.map((p) => (p.id === id ? updated : p));
    return updated;
  }

  async listSituations(projectId: string): Promise<SituationRecord[]> {
    return this.situations
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.numero - b.numero);
  }

  async listAllSituations(): Promise<SituationWithProject[]> {
    const projectById = new Map(this.projects.map((p) => [p.id, p]));
    return this.situations.flatMap((situation) => {
      const project = projectById.get(situation.projectId);
      if (!project) return [];
      return [
        {
          ...situation,
          projectReference: project.reference,
          buyerName: project.buyerName,
        },
      ];
    });
  }

  async createSituation(input: CreateSituation): Promise<SituationRecord> {
    const record: SituationRecord = {
      ...input,
      id: randomUUID(),
      status: 'brouillon',
      createdAt: new Date(),
    };
    this.situations = [...this.situations, record];
    return record;
  }

  private avenants: readonly AvenantRecord[] = [];

  async listAvenants(projectId: string): Promise<AvenantRecord[]> {
    return this.avenants
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => a.numero - b.numero);
  }

  async createAvenant(input: CreateAvenant): Promise<AvenantRecord> {
    const record: AvenantRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.avenants = [...this.avenants, record];
    return record;
  }

  async findSituationById(id: string): Promise<SituationRecord | null> {
    return this.situations.find((s) => s.id === id) ?? null;
  }

  async updateSituationStatus(
    id: string,
    status: SituationStatus,
  ): Promise<SituationRecord | null> {
    const existing = this.situations.find((s) => s.id === id) ?? null;
    if (!existing) return null;
    const updated: SituationRecord = { ...existing, status };
    this.situations = this.situations.map((s) => (s.id === id ? updated : s));
    return updated;
  }

  private tasks: readonly TaskRecord[] = [];

  async createTask(input: CreateTask): Promise<TaskRecord> {
    const status = input.status ?? 'a_faire';
    const normalized = normalizeTaskPatch({
      status,
      progressPct: input.progressPct ?? 0,
    });
    const now = new Date();
    const record: TaskRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      label: input.label,
      description: input.description,
      progressPct: normalized.progressPct ?? 0,
      status: normalized.status ?? status,
      startDate: input.startDate,
      dueDate: input.dueDate,
      orderIndex: input.orderIndex ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks = [...this.tasks, record];
    return record;
  }

  async listTasksByProject(projectId: string): Promise<TaskRecord[]> {
    return this.tasks
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }

  async findTaskById(id: string): Promise<TaskRecord | null> {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  async updateTask(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    const existing = this.tasks.find((t) => t.id === id) ?? null;
    if (!existing) return null;
    const normalized = normalizeTaskPatch(patch);
    const updated: TaskRecord = {
      ...existing,
      ...normalized,
      updatedAt: new Date(),
    };
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateProject): Promise<ProjectRecord> {
    const [row] = await this.db
      .insert(projects)
      .values({
        reference: input.reference,
        name: input.name,
        buyerName: input.buyerName,
        montantMarcheMad: input.montantMarcheMad.toString(),
        tenderId: input.tenderId,
        ordreServiceDate: input.ordreServiceDate,
        delaiMois: input.delaiMois?.toString(),
      })
      .returning();
    if (!row) throw new Error('Project insert returned no row');
    return toProject(row);
  }

  async findAll(): Promise<ProjectRecord[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));
    return rows.map(toProject);
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return row ? toProject(row) : null;
  }

  async updateStatus(
    id: string,
    status: ProjectStatus,
  ): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .update(projects)
      .set({ status, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return row ? toProject(row) : null;
  }

  async listSituations(projectId: string): Promise<SituationRecord[]> {
    const rows = await this.db
      .select()
      .from(situations)
      .where(eq(situations.projectId, projectId))
      .orderBy(asc(situations.numero));
    return rows.map(toSituation);
  }

  async listAllSituations(): Promise<SituationWithProject[]> {
    const rows = await this.db
      .select({
        situation: situations,
        projectReference: projects.reference,
        buyerName: projects.buyerName,
      })
      .from(situations)
      .innerJoin(projects, eq(situations.projectId, projects.id))
      .orderBy(asc(situations.numero));
    return rows.map((row) => ({
      ...toSituation(row.situation),
      projectReference: row.projectReference,
      buyerName: row.buyerName,
    }));
  }

  async createSituation(input: CreateSituation): Promise<SituationRecord> {
    const [row] = await this.db
      .insert(situations)
      .values({
        projectId: input.projectId,
        numero: input.numero,
        periodEnd: input.periodEnd,
        montantCumuleMad: input.montantCumuleMad.toString(),
        montantPeriodeMad: input.montantPeriodeMad.toString(),
        retenueGarantieMad: input.retenueGarantieMad.toString(),
        netAPayerMad: input.netAPayerMad.toString(),
        avancementPct: input.avancementPct.toString(),
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Situation insert returned no row');
    return toSituation(row);
  }

  async listAvenants(projectId: string): Promise<AvenantRecord[]> {
    // Since the BTP rebuild, avenants carry a statut lifecycle and approvedAt is
    // nullable (brouillons). This legacy surface feeds the décompte ceiling, so
    // it must only see APPROVED, non-deleted avenants.
    const rows = await this.db
      .select()
      .from(avenants)
      .where(
        sql`${avenants.projectId} = ${projectId} and ${avenants.deletedAt} is null and (${avenants.statut} = 'approuve' or (${avenants.statut} = 'brouillon' and ${avenants.approvedAt} is not null))`,
      )
      .orderBy(asc(avenants.numero));
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      numero: row.numero,
      objet: row.objet,
      montantDeltaMad: Number(row.montantDeltaMad),
      delaiDeltaMois: Number(row.delaiDeltaMois),
      approvedAt: row.approvedAt ?? row.createdAt,
      createdAt: row.createdAt,
    }));
  }

  async createAvenant(input: CreateAvenant): Promise<AvenantRecord> {
    const [row] = await this.db
      .insert(avenants)
      .values({
        projectId: input.projectId,
        numero: input.numero,
        objet: input.objet,
        montantDeltaMad: input.montantDeltaMad.toString(),
        delaiDeltaMois: input.delaiDeltaMois.toString(),
        approvedAt: input.approvedAt,
        // Legacy surface only ever created already-approved avenants.
        statut: 'approuve',
      })
      .returning();
    if (!row) throw new Error('Avenant insert returned no row');
    return {
      id: row.id,
      projectId: row.projectId,
      numero: row.numero,
      objet: row.objet,
      montantDeltaMad: Number(row.montantDeltaMad),
      delaiDeltaMois: Number(row.delaiDeltaMois),
      approvedAt: row.approvedAt ?? row.createdAt,
      createdAt: row.createdAt,
    };
  }

  async findSituationById(id: string): Promise<SituationRecord | null> {
    const [row] = await this.db
      .select()
      .from(situations)
      .where(eq(situations.id, id))
      .limit(1);
    return row ? toSituation(row) : null;
  }

  async updateSituationStatus(
    id: string,
    status: SituationStatus,
  ): Promise<SituationRecord | null> {
    const [row] = await this.db
      .update(situations)
      .set({ status })
      .where(eq(situations.id, id))
      .returning();
    return row ? toSituation(row) : null;
  }

  async createTask(input: CreateTask): Promise<TaskRecord> {
    const status = input.status ?? 'a_faire';
    const normalized = normalizeTaskPatch({
      status,
      progressPct: input.progressPct ?? 0,
    });
    const [row] = await this.db
      .insert(tasks)
      .values({
        projectId: input.projectId,
        label: input.label,
        description: input.description,
        progressPct: (normalized.progressPct ?? 0).toString(),
        status: normalized.status ?? status,
        startDate: input.startDate,
        dueDate: input.dueDate,
        orderIndex: input.orderIndex ?? 0,
      })
      .returning();
    if (!row) throw new Error('Task insert returned no row');
    return toTask(row);
  }

  async listTasksByProject(projectId: string): Promise<TaskRecord[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.orderIndex));
    return rows.map(toTask);
  }

  async findTaskById(id: string): Promise<TaskRecord | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return row ? toTask(row) : null;
  }

  async updateTask(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    const normalized = normalizeTaskPatch(patch);
    const [row] = await this.db
      .update(tasks)
      .set({
        label: normalized.label,
        description: normalized.description,
        ...(normalized.progressPct !== undefined
          ? { progressPct: normalized.progressPct.toString() }
          : {}),
        status: normalized.status,
        startDate: normalized.startDate,
        dueDate: normalized.dueDate,
        orderIndex: normalized.orderIndex,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    return row ? toTask(row) : null;
  }
}

type ProjectRow = typeof projects.$inferSelect;
type SituationRow = typeof situations.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    buyerName: row.buyerName,
    montantMarcheMad: Number(row.montantMarcheMad),
    tenderId: row.tenderId ?? undefined,
    ordreServiceDate: row.ordreServiceDate ?? undefined,
    delaiMois: row.delaiMois ? Number(row.delaiMois) : undefined,
    status: row.status as ProjectStatus,
    createdAt: row.createdAt,
  };
}

function toSituation(row: SituationRow): SituationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    numero: row.numero,
    periodEnd: row.periodEnd,
    montantCumuleMad: Number(row.montantCumuleMad),
    montantPeriodeMad: Number(row.montantPeriodeMad),
    retenueGarantieMad: Number(row.retenueGarantieMad),
    netAPayerMad: Number(row.netAPayerMad),
    avancementPct: Number(row.avancementPct),
    notes: row.notes ?? undefined,
    status: row.status as SituationStatus,
    createdAt: row.createdAt,
  };
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    description: row.description ?? undefined,
    progressPct: Number(row.progressPct),
    status: row.status as TaskStatus,
    startDate: row.startDate ?? undefined,
    dueDate: row.dueDate ?? undefined,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
