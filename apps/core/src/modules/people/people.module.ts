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
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { ProjectModule } from '../project/project.module';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../project/project.repository';
import {
  DrizzlePeopleRepository,
  InMemoryPeopleRepository,
  PEOPLE_REPOSITORY,
  type PeopleRepository,
} from './people.repository';

const employeeInputSchema = z.object({
  fullName: z.string().min(3).max(200),
  metier: z.string().min(2).max(100),
  cin: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
});

// rateType + rateAmountMad are optional, but go together: a pay basis without an
// amount (or an amount without a basis) would silently yield 0 dues in
// labor.domain, so superRefine rejects the half-set shape at the edge.
const assignInputSchema = z
  .object({
    projectId: z.string().uuid(),
    startDate: z.coerce.date(),
    rateType: z.enum(['jour', 'mois']).optional(),
    rateAmountMad: z.number().positive().max(100_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.rateType && value.rateAmountMad === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rateAmountMad'],
        message: 'rateAmountMad is required when rateType is set',
      });
    }
    if (value.rateAmountMad !== undefined && !value.rateType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rateType'],
        message: 'rateType is required when rateAmountMad is set',
      });
    }
  });

const workDaySchema = z.object({
  workDate: z.coerce.date(),
  daysWorked: z.number().positive().max(2),
  notes: z.string().max(1000).optional(),
});

@Controller('people')
export class PeopleController {
  constructor(
    @Inject(PEOPLE_REPOSITORY) private readonly repository: PeopleRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  /** Workforce register. */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('employees')
  async createEmployee(@Body() body: unknown) {
    const parsed = employeeInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.createEmployee(parsed.data);
  }

  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('employees')
  async listEmployees() {
    return this.repository.listEmployees();
  }

  /** Assign to a chantier — one active assignment per employee. */
  @Roles('travaux', 'direction')
  @Post('employees/:id/assign')
  async assign(@Param('id') id: string, @Body() body: unknown) {
    const parsed = assignInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const employee = await this.repository.findEmployeeById(id);
    if (!employee) throw new NotFoundException(`Employee not found: ${id}`);
    const project = await this.projects.findById(parsed.data.projectId);
    if (!project) {
      throw new NotFoundException(`Project not found: ${parsed.data.projectId}`);
    }

    const active = await this.repository.findActiveAssignment(id);
    if (active) {
      throw new ConflictException(
        'Affectation active existante — la clôturer avant une nouvelle',
      );
    }

    const created = await this.repository.createAssignment(
      id,
      parsed.data.projectId,
      parsed.data.startDate,
      { rateType: parsed.data.rateType, rateAmountMad: parsed.data.rateAmountMad },
    );
    new Logger('People').log(
      `assignment.created ${employee.fullName} → ${project.reference}`,
    );
    return created;
  }

  @Roles('travaux', 'direction')
  @Post('assignments/:id/end')
  async endAssignment(@Param('id') id: string) {
    const updated = await this.repository.endAssignment(id, new Date());
    if (!updated) throw new NotFoundException(`Assignment not found: ${id}`);
    return updated;
  }

  /** Pointage — log a work day for an assignment (idempotent on the date). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('assignments/:id/workdays')
  async logWorkDay(@Param('id') id: string, @Body() body: unknown) {
    const parsed = workDaySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const assignment = await this.repository.findAssignmentById(id);
    if (!assignment) throw new NotFoundException(`Assignment not found: ${id}`);

    const outcome = await this.repository.upsertWorkDay({
      assignmentId: id,
      workDate: parsed.data.workDate,
      daysWorked: parsed.data.daysWorked,
      notes: parsed.data.notes,
    });
    return { outcome };
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('assignments/:id/workdays')
  async workDays(@Param('id') id: string) {
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.listWorkDays(parsed.data);
  }

  /** Main-d'œuvre valorisée d'un chantier — jours, tarif, mensualité due. */
  @Roles('travaux', 'direction', 'finance', 'admin-si')
  @Get('projects/:id/labor')
  async labor(@Param('id') id: string) {
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.projectLabor(parsed.data);
  }

  /** The chantier team, with names — feeds the field journal effectifs. */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Get('projects/:id/team')
  async team(@Param('id') id: string) {
    // Single JOIN query (see listTeamByProject) — no per-assignment employee
    // fetch, so a 30-worker chantier costs one round trip, not 31.
    const members = await this.repository.listTeamByProject(id);
    const membres = members.map((member) => ({
      ...member,
      actif: member.endDate === undefined,
    }));
    return {
      effectifActif: membres.filter((member) => member.actif).length,
      membres,
    };
  }
}

const peopleRepositoryProvider = {
  provide: PEOPLE_REPOSITORY,
  useFactory: (): PeopleRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzlePeopleRepository(getDb(url));
    new Logger('PeopleModule').warn(
      'DATABASE_URL not set — people uses a non-persistent in-memory repository',
    );
    return new InMemoryPeopleRepository();
  },
};

@Module({
  imports: [ProjectModule],
  controllers: [PeopleController],
  providers: [peopleRepositoryProvider],
})
export class PeopleModule {}
