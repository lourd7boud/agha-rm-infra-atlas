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
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import type { AuthenticatedUser } from '../auth/auth.domain';
import { Roles } from '../auth/auth.module';
import { ProjectRepositoryModule } from '../project/project-repository.module';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../project/project.repository';
import { summarizeLogs } from './field.domain';
import {
  DrizzleFieldRepository,
  FIELD_REPOSITORY,
  InMemoryFieldRepository,
  type FieldRepository,
} from './field.repository';

const dailyLogInputSchema = z.object({
  reportDate: z.coerce.date(),
  effectifs: z.number().int().min(0).max(10_000),
  travauxRealises: z.string().min(10).max(5_000),
  materiel: z.string().max(2_000).optional(),
  meteo: z.string().max(200).optional(),
  blocages: z.string().max(2_000).optional(),
  incidentsSecurite: z.number().int().min(0).max(1_000).default(0),
});

interface RequestWithUser {
  user?: AuthenticatedUser;
}

@Controller('field')
export class FieldController {
  constructor(
    @Inject(FIELD_REPOSITORY) private readonly repository: FieldRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  /** Journal de chantier — the terrain role's daily report. */
  @Roles('terrain', 'travaux', 'direction')
  @Post('projects/:id/logs')
  async createLog(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser,
  ) {
    const parsed = dailyLogInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const project = await this.projects.findById(id);
    if (!project) throw new NotFoundException(`Project not found: ${id}`);
    if (project.status !== 'en_cours' && project.status !== 'suspendu') {
      throw new ConflictException(
        `Journal uniquement sur chantier actif (état: ${project.status})`,
      );
    }

    const duplicate = await this.repository.findByDate(
      id,
      parsed.data.reportDate,
    );
    if (duplicate) {
      throw new ConflictException(
        'Un rapport existe déjà pour ce chantier à cette date',
      );
    }

    const created = await this.repository.createLog({
      projectId: id,
      ...parsed.data,
      createdBy: request.user?.username ?? 'dev-mode',
    });
    new Logger('Field').log(
      `journal.created ${project.reference} ${created.reportDate.toISOString().slice(0, 10)} (effectifs ${created.effectifs})`,
    );
    return created;
  }

  /** Journal + summary for one chantier (terrain reads its own surface). */
  @Roles('terrain', 'travaux', 'direction', 'finance', 'admin-si')
  @Get('projects/:id/logs')
  async listLogs(@Param('id') id: string) {
    const project = await this.projects.findById(id);
    if (!project) throw new NotFoundException(`Project not found: ${id}`);
    const items = await this.repository.listLogs(id);
    return { summary: summarizeLogs(items), items };
  }
}

const fieldRepositoryProvider = {
  provide: FIELD_REPOSITORY,
  useFactory: (): FieldRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleFieldRepository(getDb(url));
    new Logger('FieldModule').warn(
      'DATABASE_URL not set — field uses a non-persistent in-memory repository',
    );
    return new InMemoryFieldRepository();
  },
};

@Module({
  // Only needs the PROJECT_REPOSITORY token (project existence/status checks), so
  // it depends on the leaf ProjectRepositoryModule rather than the full
  // ProjectModule — lighter, and avoids coupling field to the cost-rollup graph.
  imports: [ProjectRepositoryModule],
  controllers: [FieldController],
  providers: [fieldRepositoryProvider],
  exports: [fieldRepositoryProvider],
})
export class FieldModule {}
