import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { buildDecompte } from './decompte.domain';
import {
  DrizzleProjectRepository,
  InMemoryProjectRepository,
  PROJECT_REPOSITORY,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectStatus,
  type SituationStatus,
} from './project.repository';
import {
  computeProjectPhysicalProgress,
  summarizeTaskStatuses,
  TASK_STATUSES,
  type TaskStatus,
} from './task.domain';

const projectInputSchema = z.object({
  reference: z.string().min(3).max(200),
  name: z.string().min(3).max(500),
  buyerName: z.string().min(2).max(300),
  montantMarcheMad: z.number().positive().max(10_000_000_000),
  tenderId: z.string().uuid().optional(),
  ordreServiceDate: z.coerce.date().optional(),
  delaiMois: z.number().positive().max(240).optional(),
});

const situationInputSchema = z.object({
  periodEnd: z.coerce.date(),
  montantCumuleMad: z.number().nonnegative().max(10_000_000_000),
  notes: z.string().max(2000).optional(),
});

const transitionSchema = z.object({ to: z.string().min(2).max(30) });

const taskInputSchema = z.object({
  label: z.string().min(3).max(300),
  description: z.string().max(2000).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  status: z.enum(TASK_STATUSES as readonly [TaskStatus, ...TaskStatus[]]).optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  orderIndex: z.number().int().min(0).max(10_000).optional(),
});

const taskPatchSchema = z
  .object({
    label: z.string().min(3).max(300),
    description: z.string().max(2000),
    progressPct: z.number().min(0).max(100),
    status: z.enum(TASK_STATUSES as readonly [TaskStatus, ...TaskStatus[]]),
    startDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    orderIndex: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Au moins un champ à modifier est requis',
  });

/** Chantier lifecycle (construction ops v1). */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  preparation: ['en_cours'],
  en_cours: ['suspendu', 'receptionne'],
  suspendu: ['en_cours'],
  receptionne: ['clos'],
  clos: [],
};

/** Décompte lifecycle: drafting → submission → validation → payment. */
const SITUATION_TRANSITIONS: Record<SituationStatus, SituationStatus[]> = {
  brouillon: ['soumis'],
  soumis: ['valide'],
  valide: ['paye'],
  paye: [],
};

@Controller('project')
export class ProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repository: ProjectRepository,
  ) {}

  /** Register a chantier (from a won tender or manually). */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('projects')
  async create(@Body() body: unknown) {
    const parsed = projectInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.create(parsed.data);
  }

  /** Portfolio: every chantier with its financial position. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects')
  async list() {
    const records = await this.repository.findAll();
    return Promise.all(records.map((record) => this.present(record)));
  }

  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id')
  async detail(@Param('id') id: string) {
    const record = await this.findOr404(id);
    const situations = await this.repository.listSituations(id);
    return { ...(await this.present(record)), situations };
  }

  /** Chantier lifecycle transition. */
  @Roles('travaux', 'direction')
  @Post('projects/:id/transition')
  async transition(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    const allowed = PROJECT_TRANSITIONS[record.status] ?? [];
    if (!allowed.includes(parsed.data.to as ProjectStatus)) {
      throw new ConflictException(
        `Illegal transition: ${record.status} -> ${parsed.data.to}`,
      );
    }
    return this.repository.updateStatus(id, parsed.data.to as ProjectStatus);
  }

  /**
   * New situation de travaux: the décompte engine derives the period
   * amount, retenue de garantie and net à payer from the cumulative.
   */
  @Roles('travaux', 'direction')
  @Post('projects/:id/situations')
  async createSituation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = situationInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    if (record.status !== 'en_cours') {
      throw new ConflictException(
        `Situations uniquement sur chantier en cours (état: ${record.status})`,
      );
    }

    const existing = await this.repository.listSituations(id);
    const last = existing[existing.length - 1];
    // The décompte ceiling includes approved avenants (contract amendments).
    const avenants = await this.repository.listAvenants(id);
    const plafond =
      record.montantMarcheMad +
      avenants.reduce((sum, a) => sum + a.montantDeltaMad, 0);
    let decompte;
    try {
      decompte = buildDecompte({
        montantMarcheMad: plafond,
        montantCumuleMad: parsed.data.montantCumuleMad,
        previousCumuleMad: last?.montantCumuleMad ?? 0,
        previousRetenueCumuleMad: existing.reduce(
          (sum, s) => sum + s.retenueGarantieMad,
          0,
        ),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Décompte invalide',
      );
    }

    const created = await this.repository.createSituation({
      projectId: id,
      numero: (last?.numero ?? 0) + 1,
      periodEnd: parsed.data.periodEnd,
      montantCumuleMad: parsed.data.montantCumuleMad,
      notes: parsed.data.notes,
      ...decompte,
    });
    new Logger('Project').log(
      `situation.created ${record.reference} n°${created.numero} net=${created.netAPayerMad}`,
    );
    return created;
  }

  /** Avenant: contract amendment — direction approves, ceiling moves. */
  @Roles('direction')
  @Post('projects/:id/avenants')
  async createAvenant(@Param('id') id: string, @Body() body: unknown) {
    const schema = z.object({
      objet: z.string().min(5).max(500),
      montantDeltaMad: z.number().min(-1_000_000_000).max(1_000_000_000),
      delaiDeltaMois: z.number().min(-120).max(120).default(0),
      approvedAt: z.coerce.date(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    const existing = await this.repository.listAvenants(id);
    const created = await this.repository.createAvenant({
      projectId: id,
      numero: (existing[existing.length - 1]?.numero ?? 0) + 1,
      ...parsed.data,
    });
    new Logger('Project').log(
      `avenant.approved n°${created.numero} delta=${created.montantDeltaMad} MAD`,
    );
    return created;
  }

  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/avenants')
  async listAvenants(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listAvenants(id);
  }

  /** Add a tâche de chantier (physical work-breakdown item). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('projects/:id/tasks')
  async createTask(@Param('id') id: string, @Body() body: unknown) {
    const parsed = taskInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    return this.repository.createTask({ projectId: id, ...parsed.data });
  }

  /** Tâches with the physical avancement rollup (separate from financial). */
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('projects/:id/tasks')
  async listTasks(@Param('id') id: string) {
    await this.findOr404(id);
    const tasks = await this.repository.listTasksByProject(id);
    return {
      tasks,
      physicalProgressPct: computeProjectPhysicalProgress(tasks),
      statusSummary: summarizeTaskStatuses(tasks),
    };
  }

  /** Update a tâche — label, progress, status, dates, order. */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Patch('projects/:projectId/tasks/:taskId')
  async updateTask(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const parsed = taskPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(projectId);
    const task = await this.repository.findTaskById(taskId);
    // Scope the patch to the project: a task may only be mutated through the
    // project it belongs to, so cross-project access is rejected as not found.
    if (!task || task.projectId !== projectId) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    const updated = await this.repository.updateTask(taskId, parsed.data);
    if (!updated) throw new NotFoundException(`Task not found: ${taskId}`);
    return updated;
  }

  /** Décompte workflow — legal order enforced (brouillon→soumis→valide→paye). */
  @Roles('travaux', 'direction', 'finance')
  @Post('situations/:id/transition')
  async transitionSituation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.repository.findSituationById(id);
    if (!existing) throw new NotFoundException(`Situation not found: ${id}`);
    const to = parsed.data.to as SituationStatus;
    const allowed = SITUATION_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(
        `Illegal transition: ${existing.status} -> ${to}`,
      );
    }
    return this.repository.updateSituationStatus(id, to);
  }

  private async findOr404(id: string): Promise<ProjectRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundException(`Project not found: ${id}`);
    return record;
  }

  /** Financial position: cumulés, retenue, net payé, avancement. */
  private async present(record: ProjectRecord) {
    const situations = await this.repository.listSituations(record.id);
    const last = situations[situations.length - 1];
    return {
      ...record,
      situationsCount: situations.length,
      montantCumuleMad: last?.montantCumuleMad ?? 0,
      avancementPct: last?.avancementPct ?? 0,
      retenueCumuleeMad: situations.reduce(
        (sum, s) => sum + s.retenueGarantieMad,
        0,
      ),
    };
  }
}

const projectRepositoryProvider = {
  provide: PROJECT_REPOSITORY,
  useFactory: (): ProjectRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleProjectRepository(getDb(url));
    new Logger('ProjectModule').warn(
      'DATABASE_URL not set — project uses a non-persistent in-memory repository',
    );
    return new InMemoryProjectRepository();
  },
};

@Module({
  controllers: [ProjectController],
  providers: [projectRepositoryProvider],
  exports: [projectRepositoryProvider],
})
export class ProjectModule {}
