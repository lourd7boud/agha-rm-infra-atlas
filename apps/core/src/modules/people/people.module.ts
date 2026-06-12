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

const assignInputSchema = z.object({
  projectId: z.string().uuid(),
  startDate: z.coerce.date(),
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

  /** The chantier team, with names — feeds the field journal effectifs. */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Get('projects/:id/team')
  async team(@Param('id') id: string) {
    const assignments = await this.repository.listAssignmentsByProject(id);
    const team = [];
    for (const assignment of assignments) {
      const employee = await this.repository.findEmployeeById(
        assignment.employeeId,
      );
      if (employee) {
        team.push({
          ...assignment,
          fullName: employee.fullName,
          metier: employee.metier,
          actif: assignment.endDate === undefined,
        });
      }
    }
    return {
      effectifActif: team.filter((member) => member.actif).length,
      membres: team,
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
