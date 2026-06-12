import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { avenants, projects, situations } from '../../db/schema';

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

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface ProjectRepository {
  create(input: CreateProject): Promise<ProjectRecord>;
  findAll(): Promise<ProjectRecord[]>;
  findById(id: string): Promise<ProjectRecord | null>;
  updateStatus(id: string, status: ProjectStatus): Promise<ProjectRecord | null>;
  listSituations(projectId: string): Promise<SituationRecord[]>;
  createSituation(input: CreateSituation): Promise<SituationRecord>;
  listAvenants(projectId: string): Promise<AvenantRecord[]>;
  createAvenant(input: CreateAvenant): Promise<AvenantRecord>;
  findSituationById(id: string): Promise<SituationRecord | null>;
  updateSituationStatus(
    id: string,
    status: SituationStatus,
  ): Promise<SituationRecord | null>;
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
    const rows = await this.db
      .select()
      .from(avenants)
      .where(eq(avenants.projectId, projectId))
      .orderBy(asc(avenants.numero));
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      numero: row.numero,
      objet: row.objet,
      montantDeltaMad: Number(row.montantDeltaMad),
      delaiDeltaMois: Number(row.delaiDeltaMois),
      approvedAt: row.approvedAt,
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
      approvedAt: row.approvedAt,
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
}

type ProjectRow = typeof projects.$inferSelect;
type SituationRow = typeof situations.$inferSelect;

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
