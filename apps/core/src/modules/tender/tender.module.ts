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
import { pipelineStateSchema, tenderInputSchema } from '@atlas/contracts';
import { getDb } from '../../db/client';
import { daysUntil } from '../../lib/dates';
import { buildBackPlan, canTransition } from './tender.domain';
import {
  DrizzleTenderRepository,
  DuplicateTenderError,
  InMemoryTenderRepository,
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from './tender.repository';

const transitionBodySchema = z.object({ to: pipelineStateSchema });

function present(record: TenderRecord) {
  return { ...record, daysLeft: daysUntil(record.deadlineAt, new Date()) };
}

@Controller('tender')
export class TenderController {
  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
  ) {}

  /** Register a detected tender (Sentinel agent or manual entry). */
  @Post('tenders')
  async create(@Body() body: unknown) {
    const parsed = tenderInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const created = await this.repository.create(parsed.data);
      return present(created);
    } catch (error) {
      if (error instanceof DuplicateTenderError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /** Deadline wall: every tender ordered by urgency. */
  @Get('tenders')
  async list() {
    const records = await this.repository.findAll();
    return [...records]
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())
      .map(present);
  }

  /** J-X preparation back-plan for one tender (orchestrator view). */
  @Get('tenders/:id/plan')
  async plan(@Param('id') id: string) {
    const record = await this.findOr404(id);
    return {
      tenderId: record.id,
      reference: record.reference,
      ...buildBackPlan(record.deadlineAt, new Date()),
    };
  }

  /** Pipeline gate transition (G0–G3 actions land here). */
  @Post('tenders/:id/transition')
  async transition(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    if (!canTransition(record.pipelineState, parsed.data.to)) {
      throw new ConflictException(
        `Illegal transition: ${record.pipelineState} -> ${parsed.data.to}`,
      );
    }
    const updated = await this.repository.updateState(id, parsed.data.to);
    if (!updated) throw new NotFoundException(`Tender not found: ${id}`);
    return present(updated);
  }

  private async findOr404(id: string): Promise<TenderRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundException(`Tender not found: ${id}`);
    return record;
  }
}

const tenderRepositoryProvider = {
  provide: TENDER_REPOSITORY,
  useFactory: (): TenderRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleTenderRepository(getDb(url));
    new Logger('TenderModule').warn(
      'DATABASE_URL not set — tender uses a non-persistent in-memory repository',
    );
    return new InMemoryTenderRepository();
  },
};

@Module({
  controllers: [TenderController],
  providers: [tenderRepositoryProvider],
})
export class TenderModule {}
