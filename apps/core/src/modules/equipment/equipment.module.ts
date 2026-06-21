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
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import {
  EQUIPMENT_STATUSES,
  EquipmentTransitionError,
} from './equipment.domain';
import {
  DrizzleEquipmentRepository,
  EQUIPMENT_REPOSITORY,
  InMemoryEquipmentRepository,
  type EquipmentRepository,
} from './equipment.repository';

// ── edge validation (zod) ────────────────────────────────────────────────────

const equipmentSchema = z.object({
  name: z.string().min(2).max(300),
  code: z.string().max(60).optional(),
  category: z.string().max(120).optional(),
  acquisitionDate: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

const assignSchema = z.object({
  projectId: z.string().uuid(),
  assignedAt: z.coerce.date().optional(),
  expectedReturnAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

const returnSchema = z.object({
  returnedAt: z.coerce.date().optional(),
});

const statusSchema = z.object({
  status: z.enum(EQUIPMENT_STATUSES),
});

/** Maps a domain transition error to HTTP 409; rethrows anything else. */
function toHttp(error: unknown): never {
  if (error instanceof EquipmentTransitionError) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller('equipment')
export class EquipmentController {
  constructor(
    @Inject(EQUIPMENT_REPOSITORY)
    private readonly repository: EquipmentRepository,
  ) {}

  // ── inventory ─────────────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post()
  async createEquipment(@Body() body: unknown) {
    const parsed = equipmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.upsertEquipment(parsed.data);
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get()
  async listEquipment(@Query('status') status?: string) {
    const parsedStatus = statusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listEquipment({
      status: parsedStatus.success ? parsedStatus.data.status : undefined,
    });
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id')
  async getEquipment(@Param('id') id: string) {
    const detail = await this.repository.getEquipment(id);
    if (!detail) throw new NotFoundException('Matériel introuvable');
    return detail;
  }

  // ── assign / return ─────────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post(':id/assign')
  async assignEquipment(@Param('id') id: string, @Body() body: unknown) {
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.repository.assignEquipment({
        equipmentId: id,
        projectId: parsed.data.projectId,
        assignedAt: parsed.data.assignedAt ?? new Date(),
        expectedReturnAt: parsed.data.expectedReturnAt,
        notes: parsed.data.notes,
      });
    } catch (error: unknown) {
      toHttp(error);
    }
  }

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post(':id/return')
  async returnEquipment(@Param('id') id: string, @Body() body: unknown) {
    const parsed = returnSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const closed = await this.repository.returnEquipment({
        equipmentId: id,
        returnedAt: parsed.data.returnedAt ?? new Date(),
      });
      new Logger('Equipment').log(`equipment.returned ${id}`);
      return closed;
    } catch (error: unknown) {
      toHttp(error);
    }
  }

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Patch(':id/status')
  async setEquipmentStatus(@Param('id') id: string, @Body() body: unknown) {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.repository.setEquipmentStatus(
        id,
        parsed.data.status,
      );
      if (!updated) throw new NotFoundException('Matériel introuvable');
      return updated;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      toHttp(error);
    }
  }

  // ── per-chantier fleet ────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('projects/:id')
  async projectEquipment(@Param('id') id: string) {
    return this.repository.projectEquipment(id);
  }
}

const equipmentRepositoryProvider = {
  provide: EQUIPMENT_REPOSITORY,
  useFactory: (): EquipmentRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleEquipmentRepository(getDb(url));
    new Logger('EquipmentModule').warn(
      'DATABASE_URL not set — equipment uses a non-persistent in-memory repository',
    );
    return new InMemoryEquipmentRepository();
  },
};

@Module({
  controllers: [EquipmentController],
  providers: [equipmentRepositoryProvider],
})
export class EquipmentModule {}
