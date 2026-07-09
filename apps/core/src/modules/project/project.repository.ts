import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  avenants,
  bordereaux,
  decomptes,
  metres,
  periodes,
  projectRevisionConfig,
  projects,
  revisionFormulas,
  revisionIndexes,
  situations,
  tasks,
} from '../../db/schema';
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
  // Marché-de-travaux detail fields ported from the BTP app (nullable on
  // manually-created chantiers; populated on migrated ones).
  objet?: string;
  annee?: string;
  societe?: string;
  commune?: string;
  typeMarche?: string;
  modePassation?: string;
  delaiExecutionJours?: number;
  dateOuverture?: Date;
  receptionProvisoire?: Date;
  receptionDefinitive?: Date;
  achevementTravaux?: Date;
  assistanceTechnique?: string;
  maitreOeuvre?: string;
  progressPct?: number;
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

// ── Execution-detail records (bordereau / période / décompte / révision) ──────
export interface BordereauRecord {
  id: string;
  projectId: string;
  lignes: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PeriodeRecord {
  id: string;
  projectId: string;
  numero: number;
  libelle?: string;
  dateDebut?: Date;
  dateFin?: Date;
  tauxTva: number;
  tauxRetenue: number;
  decomptesPrecedents: number;
  depensesExercicesAnterieurs: number;
  isDecompteDernier: boolean;
  statut: string;
  observations?: string;
}

export interface DecompteRecord {
  id: string;
  projectId: string;
  periodeId?: string;
  numero: number;
  dateDecompte?: Date;
  lignes: unknown[];
  totalHtMad: number;
  montantTvaMad: number;
  totalTtcMad: number;
  totalGeneralTtcMad: number;
  montantCumuleMad: number;
  montantPrecedentMad: number;
  montantActuelMad: number;
  retenueGarantieMad: number;
  netAPayerMad: number;
  isDernier: boolean;
  statut: string;
}

export interface RevisionFormulaRecord {
  id: string;
  name: string;
  description?: string;
  fixedPart: number;
  weights: Record<string, number>;
  isDefault: boolean;
  isPublic: boolean;
}

export interface RevisionIndexRecord {
  id: string;
  monthDate: Date;
  indexValues: Record<string, number>;
  source?: string;
  status: string;
}

export interface RevisionConfigRecord {
  id: string;
  projectId: string;
  formulaId?: string;
  baseIndexes: Record<string, number>;
  baseDate?: Date;
  isEnabled: boolean;
  notes?: string;
}

export interface MetreRecord {
  id: string;
  projectId: string;
  periodeId?: string;
  bordereauLigneId?: string;
  designation?: string;
  unite?: string;
  totalQuantite: number;
  data: unknown;
}

/** Editable "fiche marché" fields of a chantier (all optional — a partial patch). */
export interface ProjectDetailsPatch {
  name?: string;
  buyerName?: string;
  montantMarcheMad?: number;
  objet?: string;
  annee?: string;
  societe?: string;
  commune?: string;
  typeMarche?: string;
  modePassation?: string;
  delaiExecutionJours?: number;
  dateOuverture?: Date;
  receptionProvisoire?: Date;
  receptionDefinitive?: Date;
  achevementTravaux?: Date;
  assistanceTechnique?: string;
  maitreOeuvre?: string;
  progressPct?: number;
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
  // Execution detail (bordereau / période / décompte / révision des prix).
  listBordereaux(projectId: string): Promise<BordereauRecord[]>;
  listPeriodes(projectId: string): Promise<PeriodeRecord[]>;
  listDecomptes(projectId: string): Promise<DecompteRecord[]>;
  getRevisionConfig(projectId: string): Promise<RevisionConfigRecord | null>;
  listRevisionFormulas(): Promise<RevisionFormulaRecord[]>;
  listRevisionIndexes(): Promise<RevisionIndexRecord[]>;
  listMetres(projectId: string): Promise<MetreRecord[]>;
  updateProjectDetails(
    id: string,
    patch: ProjectDetailsPatch,
  ): Promise<ProjectRecord | null>;
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

  // Execution-detail reads — empty in the in-memory dev fallback (these surfaces
  // are only meaningful against the real migrated Postgres data).
  async listBordereaux(): Promise<BordereauRecord[]> {
    return [];
  }
  async listPeriodes(): Promise<PeriodeRecord[]> {
    return [];
  }
  async listDecomptes(): Promise<DecompteRecord[]> {
    return [];
  }
  async getRevisionConfig(): Promise<RevisionConfigRecord | null> {
    return null;
  }
  async listRevisionFormulas(): Promise<RevisionFormulaRecord[]> {
    return [];
  }
  async listRevisionIndexes(): Promise<RevisionIndexRecord[]> {
    return [];
  }
  async listMetres(): Promise<MetreRecord[]> {
    return [];
  }
  async updateProjectDetails(
    id: string,
    patch: ProjectDetailsPatch,
  ): Promise<ProjectRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    const updated: ProjectRecord = { ...existing, ...clean };
    this.projects = this.projects.map((p) => (p.id === id ? updated : p));
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

  async listBordereaux(projectId: string): Promise<BordereauRecord[]> {
    const rows = await this.db
      .select()
      .from(bordereaux)
      .where(eq(bordereaux.projectId, projectId))
      .orderBy(asc(bordereaux.createdAt));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      lignes: Array.isArray(r.lignes) ? (r.lignes as unknown[]) : [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async listPeriodes(projectId: string): Promise<PeriodeRecord[]> {
    const rows = await this.db
      .select()
      .from(periodes)
      .where(eq(periodes.projectId, projectId))
      .orderBy(asc(periodes.numero));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      numero: r.numero,
      libelle: r.libelle ?? undefined,
      dateDebut: r.dateDebut ?? undefined,
      dateFin: r.dateFin ?? undefined,
      tauxTva: Number(r.tauxTva),
      tauxRetenue: Number(r.tauxRetenue),
      decomptesPrecedents: Number(r.decomptesPrecedents),
      depensesExercicesAnterieurs: Number(r.depensesExercicesAnterieurs),
      isDecompteDernier: r.isDecompteDernier,
      statut: r.statut,
      observations: r.observations ?? undefined,
    }));
  }

  async listDecomptes(projectId: string): Promise<DecompteRecord[]> {
    const rows = await this.db
      .select()
      .from(decomptes)
      .where(eq(decomptes.projectId, projectId))
      .orderBy(asc(decomptes.numero));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      periodeId: r.periodeId ?? undefined,
      numero: r.numero,
      dateDecompte: r.dateDecompte ?? undefined,
      lignes: Array.isArray(r.lignes) ? (r.lignes as unknown[]) : [],
      totalHtMad: Number(r.totalHtMad),
      montantTvaMad: Number(r.montantTvaMad),
      totalTtcMad: Number(r.totalTtcMad),
      totalGeneralTtcMad: Number(r.totalGeneralTtcMad),
      montantCumuleMad: Number(r.montantCumuleMad),
      montantPrecedentMad: Number(r.montantPrecedentMad),
      montantActuelMad: Number(r.montantActuelMad),
      retenueGarantieMad: Number(r.retenueGarantieMad),
      netAPayerMad: Number(r.netAPayerMad),
      isDernier: r.isDernier,
      statut: r.statut,
    }));
  }

  async getRevisionConfig(projectId: string): Promise<RevisionConfigRecord | null> {
    const [r] = await this.db
      .select()
      .from(projectRevisionConfig)
      .where(eq(projectRevisionConfig.projectId, projectId))
      .limit(1);
    if (!r) return null;
    return {
      id: r.id,
      projectId: r.projectId,
      formulaId: r.formulaId ?? undefined,
      baseIndexes: (r.baseIndexes ?? {}) as Record<string, number>,
      baseDate: r.baseDate ?? undefined,
      isEnabled: r.isEnabled,
      notes: r.notes ?? undefined,
    };
  }

  async listRevisionFormulas(): Promise<RevisionFormulaRecord[]> {
    const rows = await this.db
      .select()
      .from(revisionFormulas)
      .orderBy(asc(revisionFormulas.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      fixedPart: Number(r.fixedPart),
      weights: (r.weights ?? {}) as Record<string, number>,
      isDefault: r.isDefault,
      isPublic: r.isPublic,
    }));
  }

  async listRevisionIndexes(): Promise<RevisionIndexRecord[]> {
    const rows = await this.db
      .select()
      .from(revisionIndexes)
      .orderBy(desc(revisionIndexes.monthDate));
    return rows.map((r) => ({
      id: r.id,
      monthDate: r.monthDate,
      indexValues: (r.indexValues ?? {}) as Record<string, number>,
      source: r.source ?? undefined,
      status: r.status,
    }));
  }

  async listMetres(projectId: string): Promise<MetreRecord[]> {
    const rows = await this.db
      .select()
      .from(metres)
      .where(eq(metres.projectId, projectId))
      .orderBy(asc(metres.createdAt));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      periodeId: r.periodeId ?? undefined,
      bordereauLigneId: r.bordereauLigneId ?? undefined,
      designation: r.designation ?? undefined,
      unite: r.unite ?? undefined,
      totalQuantite: Number(r.totalQuantite),
      data: r.data,
    }));
  }

  async updateProjectDetails(
    id: string,
    patch: ProjectDetailsPatch,
  ): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .update(projects)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.buyerName !== undefined ? { buyerName: patch.buyerName } : {}),
        ...(patch.montantMarcheMad !== undefined
          ? { montantMarcheMad: patch.montantMarcheMad.toString() }
          : {}),
        ...(patch.objet !== undefined ? { objet: patch.objet } : {}),
        ...(patch.annee !== undefined ? { annee: patch.annee } : {}),
        ...(patch.societe !== undefined ? { societe: patch.societe } : {}),
        ...(patch.commune !== undefined ? { commune: patch.commune } : {}),
        ...(patch.typeMarche !== undefined ? { typeMarche: patch.typeMarche } : {}),
        ...(patch.modePassation !== undefined
          ? { modePassation: patch.modePassation }
          : {}),
        ...(patch.delaiExecutionJours !== undefined
          ? { delaiExecutionJours: patch.delaiExecutionJours }
          : {}),
        ...(patch.dateOuverture !== undefined
          ? { dateOuverture: patch.dateOuverture }
          : {}),
        ...(patch.receptionProvisoire !== undefined
          ? { receptionProvisoire: patch.receptionProvisoire }
          : {}),
        ...(patch.receptionDefinitive !== undefined
          ? { receptionDefinitive: patch.receptionDefinitive }
          : {}),
        ...(patch.achevementTravaux !== undefined
          ? { achevementTravaux: patch.achevementTravaux }
          : {}),
        ...(patch.assistanceTechnique !== undefined
          ? { assistanceTechnique: patch.assistanceTechnique }
          : {}),
        ...(patch.maitreOeuvre !== undefined
          ? { maitreOeuvre: patch.maitreOeuvre }
          : {}),
        ...(patch.progressPct !== undefined
          ? { progressPct: patch.progressPct.toString() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    return row ? toProject(row) : null;
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
    objet: row.objet ?? undefined,
    annee: row.annee ?? undefined,
    societe: row.societe ?? undefined,
    commune: row.commune ?? undefined,
    typeMarche: row.typeMarche ?? undefined,
    modePassation: row.modePassation ?? undefined,
    delaiExecutionJours: row.delaiExecutionJours ?? undefined,
    dateOuverture: row.dateOuverture ?? undefined,
    receptionProvisoire: row.receptionProvisoire ?? undefined,
    receptionDefinitive: row.receptionDefinitive ?? undefined,
    achevementTravaux: row.achevementTravaux ?? undefined,
    assistanceTechnique: row.assistanceTechnique ?? undefined,
    maitreOeuvre: row.maitreOeuvre ?? undefined,
    progressPct: row.progressPct != null ? Number(row.progressPct) : undefined,
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
