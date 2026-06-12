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
import { Roles } from '../auth/auth.module';
import { getDb } from '../../db/client';
import { daysUntil } from '../../lib/dates';
import { BrainModule } from '../brain/brain.module';
import { VaultModule } from '../vault/vault.module';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { buildComplianceChecklist } from './compliance.domain';
import { EnrichmentService } from './enrichment.service';
import { QualifierService } from './qualifier.service';
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
const enrichBodySchema = z.object({
  text: z.string().min(20, 'Texte trop court pour une extraction'),
});

function present(record: TenderRecord) {
  return { ...record, daysLeft: daysUntil(record.deadlineAt, new Date()) };
}

@Controller('tender')
export class TenderController {
  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
    @Inject(QualifierService) private readonly qualifier: QualifierService,
    @Inject(EnrichmentService) private readonly enrichment: EnrichmentService,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
  ) {}

  /** Compliance Officer (B1): administrative checklist for this tender. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/checklist')
  async checklist(@Param('id') id: string) {
    const record = await this.findOr404(id);
    const documents = await this.vault.findAll();
    return buildComplianceChecklist(record, documents, new Date());
  }

  /** Extractor (A2) over avis/DCE text → fill missing fields → re-qualify. */
  @Roles('marches', 'direction', 'admin-si')
  @Post('tenders/:id/enrich')
  async enrich(@Param('id') id: string, @Body() body: unknown) {
    const parsed = enrichBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.enrichment.enrichFromText(id, parsed.data.text);
  }

  /** Strategist (A4): G1 Go/No-Go brief on the T3 model, persisted. */
  @Roles('marches', 'direction')
  @Post('tenders/:id/brief')
  async brief(@Param('id') id: string) {
    return this.enrichment.generateG1Brief(id);
  }

  /** Run the Qualifier (A3) over all detected/parsed tenders. */
  @Roles('marches', 'direction', 'admin-si')
  @Post('tenders/qualify')
  async qualifyAll() {
    return this.qualifier.runOnce();
  }

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

  /** Full dossier for one tender — the G0/G1 review screen payload. */
  @Get('tenders/:id')
  async detail(@Param('id') id: string) {
    const record = await this.findOr404(id);
    return {
      ...present(record),
      plan: buildBackPlan(record.deadlineAt, new Date()),
    };
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
  @Roles('direction', 'marches')
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
  imports: [BrainModule, VaultModule],
  controllers: [TenderController],
  providers: [tenderRepositoryProvider, QualifierService, EnrichmentService],
  exports: [tenderRepositoryProvider],
})
export class TenderModule {}
