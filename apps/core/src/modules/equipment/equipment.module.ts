import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  EQUIPMENT_DOCUMENT_TYPES,
  METER_UNITS,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  WorkOrderTransitionError,
} from './equipment.maintenance.domain';
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
  marque: z.string().max(120).optional(),
  modele: z.string().max(120).optional(),
  numeroSerie: z.string().max(120).optional(),
  immatriculation: z.string().max(60).optional(),
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

// GMAO edge schemas ───────────────────────────────────────────────────────────

const documentSchema = z.object({
  type: z.enum(EQUIPMENT_DOCUMENT_TYPES),
  reference: z.string().max(120).optional(),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

const alertsQuerySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(30),
});

const meterReadingSchema = z.object({
  readingDate: z.coerce.date().optional(),
  value: z.coerce.number().nonnegative(),
  unit: z.enum(METER_UNITS),
  source: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
});

const workOrderSchema = z.object({
  type: z.enum(WORK_ORDER_TYPES),
  title: z.string().min(2).max(300),
  description: z.string().max(4000).optional(),
  reportedBy: z.string().max(120).optional(),
  openedAt: z.coerce.date().optional(),
  meterAtService: z.coerce.number().nonnegative().optional(),
  costMad: z.coerce.number().nonnegative().optional(),
});

const workOrderStatusSchema = z.object({
  status: z.enum(WORK_ORDER_STATUSES),
  completedAt: z.coerce.date().optional(),
  costMad: z.coerce.number().nonnegative().optional(),
  resolution: z.string().max(4000).optional(),
  meterAtService: z.coerce.number().nonnegative().optional(),
});

/** Maps a domain transition error to HTTP 409; rethrows anything else. */
function toHttp(error: unknown): never {
  if (
    error instanceof EquipmentTransitionError ||
    error instanceof WorkOrderTransitionError
  ) {
    throw new ConflictException(error.message);
  }
  throw error;
}

// ── pagination (datao-parity: DB-side LIMIT/OFFSET) ──────────────────────────
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Parse the ?page / ?limit query into a bounded DB page window. */
function parsePaging(
  page?: string,
  limit?: string,
): { limit: number; offset: number } {
  const pageNum = Math.floor(Number(page));
  const p = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 0;
  const limitNum = Math.floor(Number(limit));
  const size =
    Number.isFinite(limitNum) && limitNum > 0
      ? Math.min(limitNum, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { limit: size, offset: p * size };
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
  async listEquipment(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = statusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listEquipment(
      { status: parsedStatus.success ? parsedStatus.data.status : undefined },
      parsePaging(page, limit),
    );
  }

  // Declared BEFORE equipment/:id so the static path wins the route match
  // (otherwise ':id' would capture the literal "summary").
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('summary')
  async equipmentSummary() {
    return this.repository.equipmentSummary();
  }

  // Fleet-wide compliance alerts — declared before ':id' (static path wins).
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('documents/alerts')
  async documentAlerts(@Query('withinDays') withinDays?: string) {
    const parsed = alertsQuerySchema.safeParse({ withinDays });
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.expiringDocuments(
      parsed.data.withinDays,
      new Date(),
    );
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

  // ── GMAO: documents ─────────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post(':id/documents')
  async addDocument(@Param('id') id: string, @Body() body: unknown) {
    const parsed = documentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.ensureExists(id);
    return this.repository.addDocument({ equipmentId: id, ...parsed.data });
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id/documents')
  async listDocuments(@Param('id') id: string) {
    await this.ensureExists(id);
    return this.repository.listDocuments(id);
  }

  @Roles('travaux', 'direction', 'admin-si')
  @Delete('documents/:docId')
  async deleteDocument(@Param('docId') docId: string) {
    const deleted = await this.repository.deleteDocument(docId);
    if (!deleted) throw new NotFoundException('Document introuvable');
    return { deleted: true };
  }

  // ── GMAO: meters ────────────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post(':id/meter-readings')
  async addMeterReading(@Param('id') id: string, @Body() body: unknown) {
    const parsed = meterReadingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.ensureExists(id);
    return this.repository.addMeterReading({
      equipmentId: id,
      readingDate: parsed.data.readingDate ?? new Date(),
      value: parsed.data.value,
      unit: parsed.data.unit,
      source: parsed.data.source,
      notes: parsed.data.notes,
    });
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id/meter-readings')
  async listMeterReadings(@Param('id') id: string) {
    await this.ensureExists(id);
    return this.repository.listMeterReadings(id);
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id/meter')
  async currentMeter(@Param('id') id: string) {
    await this.ensureExists(id);
    return this.repository.currentMeter(id);
  }

  // ── GMAO: work orders ─────────────────────────────────────────────────────

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post(':id/work-orders')
  async createWorkOrder(@Param('id') id: string, @Body() body: unknown) {
    const parsed = workOrderSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.ensureExists(id);
    return this.repository.createWorkOrder({
      equipmentId: id,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      reportedBy: parsed.data.reportedBy,
      openedAt: parsed.data.openedAt ?? new Date(),
      meterAtService: parsed.data.meterAtService,
      costMad: parsed.data.costMad,
    });
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id/work-orders')
  async listWorkOrders(
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    await this.ensureExists(id);
    const parsedStatus = workOrderStatusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listWorkOrders({
      equipmentId: id,
      status: parsedStatus.success ? parsedStatus.data.status : undefined,
    });
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get(':id/cost')
  async equipmentCost(@Param('id') id: string) {
    await this.ensureExists(id);
    return { totalMad: await this.repository.equipmentCost(id) };
  }

  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Patch('work-orders/:woId/status')
  async setWorkOrderStatus(@Param('woId') woId: string, @Body() body: unknown) {
    const parsed = workOrderStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.repository.setWorkOrderStatus(
        woId,
        parsed.data,
      );
      if (!updated) {
        throw new NotFoundException("Bon d'intervention introuvable");
      }
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

  /** 404 when the machine does not exist — used before nested GMAO writes. */
  private async ensureExists(id: string): Promise<void> {
    const detail = await this.repository.getEquipment(id);
    if (!detail) throw new NotFoundException('Matériel introuvable');
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
